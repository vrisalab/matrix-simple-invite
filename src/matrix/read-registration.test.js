// @ts-check

const tryToCatch = require("try-to-catch")
const {test} = require("supertape")
const {reg, checkRegistration, getTemplateRegistration} = require("./read-registration")

test("reg: has necessary parameters", t => {
	const propertiesToCheck = ["sender_localpart", "id", "as_token", "msi"]
	t.deepEqual(
		propertiesToCheck.filter(p => p in reg),
		propertiesToCheck
	)
})

test("check: passes on sample", t => {
	checkRegistration(reg)
	t.pass("all assertions passed")
})
