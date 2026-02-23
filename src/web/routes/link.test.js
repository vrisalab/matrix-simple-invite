// @ts-check

const tryToCatch = require("try-to-catch")
const {router, test} = require("../../../test/web")
const {MatrixServerError} = require("../../matrix/mreq")
const {select, db, from} = require("../../passthrough")
const assert = require("assert").strict

test("web link create: access denied when not logged in to Matrix", async t => {
	const [error] = await tryToCatch(() => router.test("post", "/api/create-link", {
		sessionData: {
		},
		body: {
			room_address: "!zTMspHVUBhFLLSdmnS:example.com",
			valid_hours: "24",
			uses: "100",
		}
	}))
	console.log(error.data)
	t.equal(error.data, "Can't invite to room if you aren't logged in to Matrix")
})

test("web link create: check that MSI is joined", async t => {
	let called = 0
	const [error] = await tryToCatch(() => router.test("post", "/api/create-link", {
		sessionData: {
			mxid: "@user:example.com"
		},
		body: {
			room_address: "!zTMspHVUBhFLLSdmnS:example.com",
			valid_hours: "24",
			uses: "100",
		},
		api: {
			async joinRoom(roomID) {
				called++
				throw new MatrixServerError({errcode: "M_FORBIDDEN", error: "not allowed to join I guess"})
			}
		}
	}))
	t.equal(error.data, "Unable to join the requested Matrix space. Please invite the bot to the room and try again. (Server said: M_FORBIDDEN - not allowed to join I guess)")
	t.equal(called, 1)
})

test("web link create: check that MSI can invite", async t => {
	let called = 0
	const [error] = await tryToCatch(() => router.test("post", "/api/create-link", {
		sessionData: {
			mxid: "@user:example.com"
		},
		body: {
			room_address: "!zTMspHVUBhFLLSdmnS:example.com",
			valid_hours: "24",
			uses: "100",
		},
		api: {
			async joinRoom(roomID) {
				called++
				return roomID
			},
			async getInvitePowerLevel(roomID, api) {
				called++
				t.equal(roomID, "!zTMspHVUBhFLLSdmnS:example.com")
				return 1000
			},
			async getStateEvent(roomID, type, key) {
				called++
				t.equal(roomID, "!zTMspHVUBhFLLSdmnS:example.com")
				t.equal(type, "m.room.power_levels")
				t.equal(key, "")
				return {invite: 100, users: {"@_ooye_bot:example.com": 50}}
			},
			async getStateEventOuter(roomID, type, key) {
				called++
				t.equal(roomID, "!zTMspHVUBhFLLSdmnS:example.com")
				t.equal(type, "m.room.create")
				t.equal(key, "")
				return {
					type: "m.room.create",
					state_key: "",
					sender: "@creator:example.com",
					room_id: "!zTMspHVUBhFLLSdmnS:example.com",
					event_id: "$create",
					origin_server_ts: 0,
					content: {
						room_version: "11"
					}
				}
			}
		}
	}))
	t.equal(error.data, "MSI needs permission to invite people")
	t.equal(called, 4)
})

test("web link create: check that user can invite", async t => {
	let called = 0
	const [error] = await tryToCatch(() => router.test("post", "/api/create-link", {
		sessionData: {
			mxid: "@user:example.com"
		},
		body: {
			room_address: "!zTMspHVUBhFLLSdmnS:example.com",
			valid_hours: "24",
			uses: "100",
		},
		api: {
			async joinRoom(roomID) {
				called++
				return roomID
			},
			async getInvitePowerLevel(roomID, api) {
				called++
				t.equal(roomID, "!zTMspHVUBhFLLSdmnS:example.com")
				return 100
			},
			async getStateEvent(roomID, type, key) {
				called++
				t.equal(roomID, "!zTMspHVUBhFLLSdmnS:example.com")
				t.equal(type, "m.room.power_levels")
				t.equal(key, "")
				return {invite: 100, users: {"@_msi_bot:example.com": 100, "@user:example.com": 50}, events: {"m.room.tombstone": 150}}
			},
			async getStateEventOuter(roomID, type, key) {
				called++
				t.equal(roomID, "!zTMspHVUBhFLLSdmnS:example.com")
				t.equal(type, "m.room.create")
				t.equal(key, "")
				return {
					type: "m.room.create",
					state_key: "",
					sender: "@creator:example.com",
					room_id: "!zTMspHVUBhFLLSdmnS:example.com",
					event_id: "$create",
					origin_server_ts: 0,
					content: {
						room_version: "12"
					}
				}
			}
		}
	}))
	t.equal(error.data, "You need permissions to invite people to the server to create an invite link")
	t.equal(called, 4)
})

test("web link create: successfully adds entry to database and loads page", async t => {
	let called = 0
	let room_id = "!zTMspHVUBhFLLSdmnS:example.com"
	let bot_mxid = "@_msi_bot:example.com"
	await router.test("post", "/api/create-link", {
		sessionData: {
			mxid: "@user:example.com"
		},
		body: {
			room_address: room_id,
			valid_hours: "24",
			uses: "100",
		},
		api: {
			async getStateEvent(roomID, type, key) {
				called++
				t.equal(roomID, room_id)
				t.equal(key, "")
				if (type == "m.room.power_levels")
					return {invite: 50, users: {"@user:example.com": 50, bot_mxid: 50}}
				if (type == "m.room.avatar")
					return {url: "mxc://room1_icon"}
				if (type == "m.room.name")
					return {name: "Room 1"}
			},
			async getStateEventOuter(roomID, type, key) {
				called++
				t.equal(roomID, room_id)
				t.equal(type, "m.room.create")
				t.equal(key, "")
				return {
					type: "m.room.create",
					state_key: "",
					sender: "@user:example.com",
					room_id: room_id,
					event_id: "$create",
					origin_server_ts: 0,
					content: {
						room_version: "12"
					}
				}
			},
			async joinRoom(roomID, mxid, via){
				t.equal(roomID, room_id)
				t.equal(mxid, null)
				t.deepEqual(via, ["example.com"])
				return roomID
			},
			async getInvitePowerLevel(roomID, api){
				t.equal(roomID, room_id)
				return 0	
			},
			async getProfile(mxid){
				t.equal(mxid, "@user:example.com")
				return {displayname: "User 1", avatar_url: "mxc://use1_icon"}
			}
		}
	})
	t.equal(called, 4)

	// check that the entry was added to the database
	const row = from("invite_link").select("id", "room_id").where({room_id: room_id}).get()
	t.equal(row?.room_id, room_id)

	// check that the link info page now loads
	const html = await router.test("get", "/gg?id=" + row?.id, {
		sessionData: {
			mxid: "@user:example.com"
		}
	})
	t.has(html, `<button class="s-btn s-btn__icon s-btn__matrix s-btn__filled" id="invite"> Invite me!`)
})

// *****
// TODO: Add tests for web link delete