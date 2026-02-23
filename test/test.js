// @ts-check

const fs = require("fs")
const {join} = require("path")
const sqlite = require("better-sqlite3")
const migrate = require("../src/db/migrate")
const HeatSync = require("heatsync")
const {test, extend} = require("supertape")

const passthrough = require("../src/passthrough")
const db = new sqlite(":memory:")

const {reg} = require("../src/matrix/read-registration")
console.log(reg)
reg.sender_localpart = "_msi_bot"
reg.id = "baby"
reg.as_token = "don't actually take authenticated actions on the server"
reg.hs_token = "don't actually take authenticated actions on the server"
reg.namespaces = {
	users: [{regex: "@_msi_.*:example.com", exclusive: true}],
}
reg.msi.server_origin = "https://matrix.example.com" // so that tests will pass even when hard-coded
reg.msi.server_name = "example.com"
reg.msi.web_origin = "https://msi.example.com"
reg.msi.data_path = "./data"
reg.msi.content_length_workaround = false

const sync = new HeatSync({watchFS: false})

Object.assign(passthrough, { sync, db })

const orm = sync.require("../src/db/orm")
passthrough.from = orm.from
passthrough.select = orm.select

;(async () => {
	const p = migrate.migrate(db)
	test("migrate: migration works", async t => {
		await p
		t.pass("it did not throw an error")
	})
	await p

	test("migrate: migration works the second time", async t => {
		await migrate.migrate(db)
		t.pass("it did not throw an error")
	})

	db.exec(fs.readFileSync(join(__dirname, "msi-test-data.sql"), "utf8"))

	require("../src/db/orm.test")
	require("../src/web/server.test")
	require("../src/matrix/api.test")
	require("../src/matrix/mreq.test")
	require("../src/matrix/read-registration.test")
	require("../src/matrix/txnid.test")
	require("../src/matrix/utils.test")
	require("../src/web/routes/link.test")
	require("../src/web/routes/log-in-with-matrix.test")
})()
