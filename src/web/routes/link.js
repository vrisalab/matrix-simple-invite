// @ts-check

const w =  require('node:stream')
const assert = require("assert").strict
const path = require('path')
const fs = require("fs")
const {z} = require("zod")
const {defineEventHandler, createError, readValidatedBody, setResponseHeader, H3Event, sendRedirect} = require("h3")
const Ty = require("../../types")

const {db, as, sync, select, from} = require("../../passthrough")
/** @type {import("../pug-sync")} */
const pugSync = sync.require("../pug-sync")
const { randomUUID } = require("crypto")
const { parse } = require("path")
const { reg } = require("../../matrix/read-registration")
const { create } = require('node:domain')
/** @type {import("../auth")} */
const auth = sync.require("../auth")
/** @type {import("../../matrix/utils")}*/
const utils = sync.require("../../matrix/utils")
/** @type {import("./invite")} */

/**
 * @param {H3Event} event
 * @returns {import("../../matrix/api")}
 */
function getAPI(event) {
	/* c8 ignore next */
	return event.context.api || sync.require("../../matrix/api")
}

const schema = {
	createInvite: z.object({
		room_address: z.string(),
		valid_hours: z.string(),
		uses: z.string()
	}),
	deleteInvite: z.object({
		invite_link_id: z.string(),
	}),
}

/**
 * 
 * @param {string} address 
 * @param {import("../../matrix/api")} api
 */
async function parseRoomAddress(address, api){
	if (address[0] == "!") return address
	if (address[0] === "#") {
		try {
			return (await api.getAlias(address))
		} catch (e) {
		}
	}
	const address_url = new URL(address)
	if(address_url.hostname == "matrix.to"){
		return parseRoomAddress(address_url.hash.slice(2).split("?")[0], api)
	}
	return null
}


/**
 * 
 * @param {string} mxc 
 * @param {import("../../matrix/api")} api
 * @param {*} init 
 * @returns 
 */
async function saveImage(mxc, api, init) {
	const media_id = new URL(mxc).pathname.slice(1)
	let save_path = path.join(reg.msi.data_path, "media", media_id + ".png")
	if (fs.existsSync(save_path)) return media_id

	let img_response = await api.getMedia(mxc, init)
	const img_stream = w.Readable.fromWeb(img_response.body);

    const file = fs.createWriteStream(save_path);
	img_stream.pipe(file)
	return media_id
};


as.router.post("/api/create-link", defineEventHandler(async event => {
	const parsedBody = await readValidatedBody(event, schema.createInvite.parse)
	const session = await auth.useSession(event)
	const api = getAPI(event)

	if (!session.data.mxid) throw createError({status: 403, message: "Forbidden", data: "Can't invite to room if you aren't logged in to Matrix"})

	// Parse room address
	const roomID = await parseRoomAddress(parsedBody.room_address, api)	
	if(!roomID){
		throw createError({status: 400, message: "Bad room address", data: "Room address is not in one of the accepted formats"})
	}

	const inviteServer = roomID.match(/:(.*)/)?.[1]
	if(!inviteServer){
		throw createError({status: 400, message: "Bad room address", data: "Please include the full room address"})
	}
	const via = [inviteServer]

	// Check that the bot can join the room
	try {
		await api.joinRoom(roomID, null, via)
	} catch (e) {
		throw createError({status: 400, message: "Unable To Join", data: `Unable to join the requested Matrix space. Please invite the bot to the room and try again. (Server said: ${e.errcode} - ${e.message})`})
	}

	// Check that bot can create invites
	const {powerLevels, powers: {[utils.bot]: selfPowerLevel, [session.data.mxid]: invitingPowerLevel}} = await utils.getEffectivePower(roomID, [utils.bot, session.data.mxid], api)

	const invitePowerLevel = await api.getInvitePowerLevel(roomID, api)
	if (selfPowerLevel < invitePowerLevel) throw createError({status: 400, message: "MSI can't invite people", data: "MSI needs permission to invite people"})

	// Check inviting user can create invites
	if (invitingPowerLevel < invitePowerLevel) throw createError({status: 403, message: "You need permission to invite people in the server to create an invite link. Forbidden", data: `You need permissions to invite people to the server to create an invite link`})
	
	// Create the invite link

	// Make sure it does not exist (who knows?)
	let is_unique = false
	let link_id = randomUUID().slice(0,8)
	while (!is_unique){
		const link = await auth.getLink(link_id)
		if(!link) is_unique = true
		link_id = randomUUID().slice(0,8)
	}

	const now = new Date()

	const room_name = (await api.getStateEvent(roomID, "m.room.name", "")).name

	let room_icon = ""
	let room_icon_mxc = null
	try{
		room_icon_mxc = (await api.getStateEvent(roomID, "m.room.avatar", "")).url
	}
	catch (e) {}

	if (room_icon_mxc){
		try {
			room_icon = await saveImage(room_icon_mxc, api, {height: "48"})
		}
		catch(e){
			createError({status: 500, message: "Failed to write icon file", data: "Failed to write icon file"})
		}
	}
		
	const creator_profile = await api.getProfile(session.data.mxid)
	const creator_name = creator_profile.displayname
	let creator_icon = ""
	if (creator_profile.avatar_url){
		try {
			creator_icon = await saveImage(creator_profile.avatar_url, api, {height: "48"})
		}
		catch(e){
			createError({status: 500, message: "Failed to write icon file", data: "Failed to write icon file"})
		}
	}

	const creation_date = now.getTime()
	const valid_hours = parseInt(parsedBody.valid_hours)
	let expiration_date
	if (valid_hours == -1){
		expiration_date = -1
	}
	else {
		expiration_date = new Date(now.getTime() + valid_hours * 60 * 60 * 1000).getTime()
	}
	const max_uses = parseInt(parsedBody.uses)
	const url = reg.url + "/gg?id=" + link_id

	// Insert database entry
	db.transaction(() => {
		db.prepare("INSERT INTO invite_link (id, room_id, room_icon, room_name, creator_mxid, creator_icon, creator_name, creation_date, expiration_date, max_uses, uses, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		.run(link_id, roomID, room_icon, room_name, session.data.mxid, creator_icon, creator_name, creation_date, expiration_date, max_uses, 0, url)
	})()

	setResponseHeader(event, "HX-Refresh", "true")
	return sendRedirect(event, `/link-box?link=${url}`, 302)
}))

/**
 * 
 * @param {number} expiration_date 
 * @returns 
 */
function get_reamining_time(expiration_date) {
  if(expiration_date==-1) return "Never"

  let diff = Math.floor((expiration_date - Date.now()) / 1000)
  const units = [
	{ d: 60, s: "", trim: false},
	{ d: 60, s: ":", trim: false},
	{ d: 24, s: ":", trim: false},
	{ d: 7, s: ":", trim: true}
  ];

  var ddhhmmss = '';
  for (const unit of units) {
	var unit_difference = String(diff % unit.d)

	if(unit_difference.length == 1) unit_difference = "0" + unit_difference
	if(unit_difference != "00" || !unit.trim) ddhhmmss = unit_difference + unit.s + ddhhmmss;

	diff = Math.floor(diff / unit.d);
  }
  return ddhhmmss
}


as.router.post("/api/delete-link", defineEventHandler(async event => {
	const {invite_link_id} = await readValidatedBody(event, schema.deleteInvite.parse)
	const session = await auth.useSession(event)
	
	// Check if link exists
	const link = await auth.getLink(invite_link_id)
	if (!link) throw createError({status: 400, message: "Bad Request", data: "Link does not exist."})

	// Check that creator is trying to delete it
	// TODO: This power should be extended to any room admins
	if (link.creator_mxid != session.data.mxid) throw createError({status: 400, message: "Bad Request", data: "User can't delete this invitation link"})

	db.prepare("DELETE FROM invite_link WHERE id = ?").run(link.id)
	
	setResponseHeader(event, "HX-Refresh", "true")
	return null // 204
	
}))
as.router.get("/manage-links", defineEventHandler(async event => {
	const session = await auth.useSession(event)
	// Check if you are logged in
	if (!session.data.mxid){
		return pugSync.render(event, "not_logged_in.pug", {})
	}
	
	const links = from("invite_link").select("room_name", "room_icon", "creator_name", "creator_icon", "creator_mxid", "room_id", "uses", "max_uses", "expiration_date", "id", "url").where({creator_mxid: session.data.mxid}).all()
	let calculatedFields = {}
	for(const link of links){
		let remaining_time = get_reamining_time(link.expiration_date)	
		calculatedFields[link.id] = {
			"remaining_time": remaining_time
		}
	}

	return pugSync.render(event, "manage-links.pug", {linkList: links, calculatedFields})
}))