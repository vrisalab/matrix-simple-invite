#!/usr/bin/env node
// @ts-check


const path = require('path')
const fs = require("fs")
const sqlite = require("better-sqlite3")
const migrate = require("./src/db/migrate")
const HeatSync = require("heatsync")
const {reg} = require("./src/matrix/read-registration")
const passthrough = require("./src/passthrough")

const sync = new HeatSync({watchFunction: fs.watchFile})

// Make sure work dirs and database are set up
fs.mkdirSync(path.join(reg.msi.data_path, "media"), { recursive: true, })
const db = new sqlite(path.join(reg.msi.data_path, "msi.db"))


Object.assign(passthrough, {sync, db})

const {as} = require("./src/matrix/appservice")
passthrough.as = as

const orm = sync.require("./src/db/orm")
passthrough.from = orm.from
passthrough.select = orm.select

sync.require("./src/matrix/event-dispatcher")


;(async () => {
	await migrate.migrate(db)

	sync.require("./src/web/server")

	const api = require("./src/matrix/api")
	await api.register(reg.sender_localpart)

	as.listen()
})()