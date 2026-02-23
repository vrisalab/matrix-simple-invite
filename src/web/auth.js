// @ts-check

const h3 = require("h3")
const {reg} = require("../matrix/read-registration")
const {db, as, sync, select, from} = require("../passthrough")


/**
 * @param {h3.H3Event} event
 * @returns {ReturnType<typeof h3.useSession<{userID?: string, mxid?: string, managedLinks?: string[], state?: string, selfService?: boolean, password?: string}>>}
 */
function useSession(event) {
	return h3.useSession(event, {password: reg.as_token, maxAge: 365 * 24 * 60 * 60})
}


/**
 * Get all of the user's links managed by this Matrix account
 * @param {h3.H3Event} event
 * @returns {Promise<Set<string>>} Invites
 */
async function getManagedLinks(event) {
	const session = await useSession(event)
	const managed = new Set(session.data.managedLinks || [])
	if (session.data.mxid) {
		const inviteLinks = db.prepare("SELECT * FROM invite_link WHERE creator_mxid = ?").pluck().all(session.data.mxid)
		for (const link of inviteLinks) {
			managed.add(link)
		}
	}
	return managed
}

/**
 * Get all invites created for this room
 * @param {string} room_id
 * @returns {Promise<string>} Invites
 */
async function getRoomLinks(room_id) {
	const links = new Set([])
	const inviteLinks = db.prepare("SELECT * FROM invite_link WHERE room_id = ?").pluck().all(room_id)
	for (const link of inviteLinks) {
		links.add(link)
	}
	return links
}


/**
 * Get invite link by id
 * @param {string} invite_link_id
 * @returns {Promise<any>} link
 */
async function getLink(invite_link_id) {
	const link = db.prepare("SELECT * FROM invite_link WHERE id = ?").get(invite_link_id)
	return link
}

module.exports.useSession = useSession
module.exports.getManagedLinks = getManagedLinks
module.exports.getRoomLinks = getRoomLinks
module.exports.getLink = getLink