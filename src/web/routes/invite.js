// @ts-check

const assert = require("assert/strict")
const {z} = require("zod")
const {H3Event, defineEventHandler, sendRedirect, createError, getValidatedQuery, readValidatedBody, setResponseHeader} = require("h3")
const {randomUUID} = require("crypto")
const {LRUCache} = require("lru-cache")
const Ty = require("../../types")
const uqr = require("uqr")

const {as, sync, select, from, db} = require("../../passthrough")
/** @type {import("../pug-sync")} */
const pugSync = sync.require("../pug-sync")
/** @type {import("../auth")} */
const auth = require("../auth")
/** @type {import("../../matrix/utils")} */
const mxUtils = sync.require("../../matrix/utils")
const {reg} = require("../../matrix/read-registration")

/**
 * @param {H3Event} event
 * @returns {import("../../matrix/api")}
 */
function getAPI(event) {
	/* c8 ignore next */
	return event.context.api || sync.require("../../matrix/api")
}

const schema = {
	invite: z.object({
		mxid: z.string().regex(/@([^:]+):([a-z0-9:-]+\.[a-z0-9.:-]+)/),
		invite_link_id: z.string().optional(),
	}),
	gg: z.object({
		id: z.string()
	}),
}

function isValidInvite(invite_link){
	let validityError
	if (invite_link.max_uses >= 0 && invite_link.uses >= invite_link.max_uses){
		validityError = "There are no more uses left for this invite!"
	}
	if (parseInt(invite_link.expiration_date) >= 0 && parseInt(invite_link.expiration_date) < Date.now()){
		validityError = "Invitation is expired"
	}
	return validityError
}

as.router.get("/gg", defineEventHandler(async event => {
	const {id: invite_link_id} = await getValidatedQuery(event, schema.gg.parse)
	const session = await auth.useSession(event)

	const link = from("invite_link").select("room_name", "room_icon", "creator_name", "creator_icon", "room_id", "uses", "max_uses", "expiration_date").where({id: invite_link_id}).get()

	if (link){
		// Check if you are logged in
		if (!session.data.mxid){
			return pugSync.render(event, "not_logged_in.pug", {})
		}
		const room_name = link.room_name
		const room_icon = link.room_icon
		const creator_name = link.creator_name
		const creator_icon = link.creator_icon

		// Check invite validity
		let validityError = isValidInvite(link)
		if (validityError) return pugSync.render(event, "invalid_link.pug", {validityError})

		return pugSync.render(event, "gg.pug", {session,  room_name, room_icon, creator_name, creator_icon, invite_link_id})
	} else {
		return pugSync.render(event, "invalid_link.pug", {validityError: "Link not found"})
	}
	
}))


as.router.post("/api/invite", defineEventHandler(async event => {
	const session = await auth.useSession(event)
	const parsedBody = await readValidatedBody(event, schema.gg.parse)
	const api = getAPI(event)
	

	// Check invite id
	if (parsedBody.id) {
		var invite_link_id = parsedBody.id
	} else {
		throw createError({status: 400, message: "Missing link ID", data: "No link ID in request"})
	}
    
    // Get invite by id
    const link = await auth.getLink(invite_link_id)
    assert(link)

	// Check invite validity
	let validityError = isValidInvite(link)
	if (validityError){
		throw createError({status: 400, message: "Invalid Link", data: validityError})	
	}
    
	// Check for existing invite to the space
	let roomMember
	try {
		roomMember = await api.getStateEvent(link.room_id, "m.room.member", session.data.mxid)
	} catch (e) {}

	if (!roomMember || !["invite", "join"].includes(roomMember.membership)) {
		// Invite
		await api.inviteToRoom(link.room_id, session.data.mxid)
	}
	
	// Update uses
	db.transaction(() => {
		db.prepare("UPDATE invite_link SET uses = (?) WHERE id = (?)").run(link.id, link.uses + 1)
	})()

    return sendRedirect(event, "/ok?msg=You have been invited", 302)
}))