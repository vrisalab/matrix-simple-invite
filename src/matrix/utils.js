// @ts-check

const assert = require("assert").strict
const Ty = require("../types")
const {tag} = require("@cloudrac3r/html-template-tag")
const passthrough = require("../passthrough")
const {db} = passthrough

const {reg} = require("./read-registration")
const userRegex = reg.namespaces.users.map(u => new RegExp(u.regex))

/** @type {import("xxhash-wasm").XXHashAPI} */ // @ts-ignore
let hasher = null
// @ts-ignore
require("xxhash-wasm")().then(h => hasher = h)

const bot = `@${reg.sender_localpart}:${reg.msi.server_name}`

const BLOCK_ELEMENTS = [
	"ADDRESS", "ARTICLE", "ASIDE", "AUDIO", "BLOCKQUOTE", "BODY", "CANVAS",
	"CENTER", "DD", "DETAILS", "DIR", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE",
	"FOOTER", "FORM", "FRAMESET", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER",
	"HGROUP", "HR", "HTML", "ISINDEX", "LI", "MAIN", "MENU", "NAV", "NOFRAMES",
	"NOSCRIPT", "OL", "OUTPUT", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD",
	"TFOOT", "TH", "THEAD", "TR", "UL"
]
const NEWLINE_ELEMENTS = BLOCK_ELEMENTS.concat(["BR"])

/**
 * Event IDs are really big and have more entropy than we need.
 * If we want to store the event ID in the database, we can store a more compact version by hashing it with this.
 * I choose a 64-bit non-cryptographic hash as only a 32-bit hash will see birthday collisions unreasonably frequently: https://en.wikipedia.org/wiki/Birthday_attack#Mathematics
 * xxhash outputs an unsigned 64-bit integer.
 * Converting to a signed 64-bit integer with no bit loss so that it can be stored in an SQLite integer field as-is: https://www.sqlite.org/fileformat2.html#record_format
 * This should give very efficient storage with sufficient entropy.
 * @param {string} eventID
 */
function getEventIDHash(eventID) {
	assert(hasher, "xxhash is not ready yet")
	if (eventID[0] === "$" && eventID.length >= 13) {
		eventID = eventID.slice(1) // increase entropy per character to potentially help xxhash
	}
	const unsignedHash = hasher.h64(eventID)
	const signedHash = unsignedHash - 0x8000000000000000n // shifting down to signed 64-bit range
	return signedHash
}

class MatrixStringBuilderStack {
	constructor() {
		this.stack = [new MatrixStringBuilder()]
	}

	get msb() {
		return this.stack[0]
	}

	bump() {
		this.stack.unshift(new MatrixStringBuilder())
	}

	shift() {
		const msb = this.stack.shift()
		assert(msb)
		return msb
	}
}

class MatrixStringBuilder {
	constructor() {
		this.body = ""
		this.formattedBody = ""
	}

	/**
	 * @param {string} body
	 * @param {string} [formattedBody]
	 * @param {any} [condition]
	 */
	add(body, formattedBody, condition = true) {
		if (condition) {
			if (formattedBody == undefined) formattedBody = tag`${body}`
			this.body += body
			this.formattedBody += formattedBody
		}
		return this
	}

	/**
	 * @param {string} body
	 * @param {string} [formattedBody]
	 * @param {any} [condition]
	 */
	addLine(body, formattedBody, condition = true) {
		if (condition) {
			if (formattedBody == undefined) formattedBody = tag`${body}`
			if (this.body.length && this.body.slice(-1) !== "\n") this.body += "\n"
			this.body += body
			const match = this.formattedBody.match(/<\/?([a-zA-Z]+[a-zA-Z0-9]*)[^>]*>\s*$/)
			if (this.formattedBody.length && (!match || !NEWLINE_ELEMENTS.includes(match[1].toUpperCase()))) this.formattedBody += "<br>"
			this.formattedBody += formattedBody
		}
		return this
	}

	/**
	 * @param {string} body
	 * @param {string} [formattedBody]
	 * @param {any} [condition]
	 */
	addParagraph(body, formattedBody, condition = true) {
		if (condition) {
			if (formattedBody == undefined) formattedBody = tag`${body}`
			if (this.body.length && this.body.slice(-1) !== "\n") this.body += "\n\n"
			this.body += body
			const match = formattedBody.match(/^<([a-zA-Z]+[a-zA-Z0-9]*)/)
			if (!match || !BLOCK_ELEMENTS.includes(match[1].toUpperCase())) formattedBody = `<p>${formattedBody}</p>`
			this.formattedBody += formattedBody
		}
		return this
	}

	get() {
		return {
			msgtype: "m.text",
			body: this.body,
			format: "org.matrix.custom.html",
			formatted_body: this.formattedBody
		}
	}
}

/**
 * @param {string} roomVersionString
 * @param {number} desiredVersion
 */
function roomHasAtLeastVersion(roomVersionString, desiredVersion) {
	/*
		I hate this.
		The spec instructs me to compare room versions ordinally, for example, "In room versions 12 and higher..."
		So if the real room version is 13, this should pass the check.
		However, the spec also says "room versions are not intended to be parsed and should be treated as opaque identifiers", "due to versions not being ordered or hierarchical".
		So versions are unordered and opaque and you can't parse them, but you're still expected to parse them to a number and compare them to another number to measure if it's "12 or higher"?
		Theoretically MSC3244 would clean this up, but that isn't happening since Element removed support for MSC3244: https://github.com/element-hq/element-web/commit/644b8415912afb9c5eed54859a444a2ee7224117
		Element replaced it with the following function:
	*/

	// Assumption: all unstable room versions don't support the feature. Calling code can check for unstable
	// room versions explicitly if it wants to. The spec reserves [0-9] and `.` for its room versions.
	if (!roomVersionString.match(/^[\d.]+$/)) {
		return false;
	}

	// Element dev note: While the spec says room versions are not linear, we can make reasonable assumptions
	// until the room versions prove themselves to be non-linear in the spec. We should see this coming
	// from a mile away and can course-correct this function if needed.
	return Number(roomVersionString) >= Number(desiredVersion);
}

/**
 * Starting in room version 12, creators may not be specified in power levels users.
 * Modifies the input power levels.
 * @param {Ty.Event.StateOuter<Ty.Event.M_Room_Create>} roomCreateOuter
 * @param {Ty.Event.M_Power_Levels} powerLevels
 */
function removeCreatorsFromPowerLevels(roomCreateOuter, powerLevels) {
	assert(roomCreateOuter.sender)
	if (roomHasAtLeastVersion(roomCreateOuter.content.room_version, 12) && powerLevels.users) {
		for (const creator of (roomCreateOuter.content.additional_creators ?? []).concat(roomCreateOuter.sender)) {
			delete powerLevels.users[creator]
		}
	}
	return powerLevels
}

/**
 * @template {string} T
 * @param {string} roomID
 * @param {T[]} mxids
 * @param {{[K in "getStateEvent" | "getStateEventOuter"]: import("./api")[K]}} api
 * @returns {Promise<{powers: Record<T, number>, allCreators: string[], tombstone: number, roomCreate: Ty.Event.StateOuter<Ty.Event.M_Room_Create>, powerLevels: Ty.Event.M_Power_Levels}>}
 */
async function getEffectivePower(roomID, mxids, api) {
	/** @type {[Ty.Event.StateOuter<Ty.Event.M_Room_Create>, Ty.Event.M_Power_Levels]} */
	const [roomCreate, powerLevels] = await Promise.all([
		api.getStateEventOuter(roomID, "m.room.create", ""),
		api.getStateEvent(roomID, "m.room.power_levels", "")
	])
	const allCreators =
		( roomHasAtLeastVersion(roomCreate.content.room_version, 12) ? (roomCreate.content.additional_creators ?? []).concat(roomCreate.sender)
		: [])
	const tombstone =
		( roomHasAtLeastVersion(roomCreate.content.room_version, 12) ? powerLevels.events?.["m.room.tombstone"] ?? 150
		: powerLevels.events?.["m.room.tombstone"] ?? powerLevels.state_default ?? 50)
	/** @type {Record<T, number>} */ // @ts-ignore
	const powers = {}
	for (const mxid of mxids) {
		powers[mxid] =
			( roomHasAtLeastVersion(roomCreate.content.room_version, 12) && allCreators.includes(mxid) ? Infinity
			: powerLevels.users?.[mxid]
			?? powerLevels.users_default
			?? 0)
	}
	return {powers, allCreators, tombstone, roomCreate, powerLevels}
}


module.exports.bot = bot
module.exports.BLOCK_ELEMENTS = BLOCK_ELEMENTS
module.exports.getEventIDHash = getEventIDHash
module.exports.MatrixStringBuilder = MatrixStringBuilder
module.exports.MatrixStringBuilderStack = MatrixStringBuilderStack
module.exports.roomHasAtLeastVersion = roomHasAtLeastVersion
module.exports.removeCreatorsFromPowerLevels = removeCreatorsFromPowerLevels
module.exports.getEffectivePower = getEffectivePower
