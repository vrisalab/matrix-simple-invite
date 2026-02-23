// @ts-check


const {db, sync, as, select} = require("../passthrough")
const {tag} = require("@cloudrac3r/html-template-tag")

/** @type {import("./utils")} */
const utils = sync.require("../matrix/utils")
/** @type {import("./api")}) */
const api = sync.require("../matrix/api")


// Handle invite events
as.on("type:m.room.member", async event => {
	if (event.state_key[0] !== "@") return

	if (event.content.membership === "invite" && event.state_key === utils.bot) {
		// We were invited to a room
		try {
			var inviteRoomState = await api.getInviteState(event.room_id, event)
		} catch (e) {
			console.error(e)
			return await api.leaveRoomWithReason(event.room_id, `I wasn't able to find out what this room is. Please report this as a bug. Check console for more details. (${e.toString()})`)
		}
		if (!inviteRoomState?.name) return await api.leaveRoomWithReason(event.room_id, `Please only invite me to rooms that have a name set. Update the room details and reinvite.`)
		await api.joinRoom(event.room_id)
	}
})
