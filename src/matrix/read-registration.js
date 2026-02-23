// @ts-check

const fs = require("fs")
const crypto = require("crypto")
const assert = require("assert").strict
const path = require("path")

const registrationFilePath = path.join(process.cwd(), "registration.yaml")

/** @param {import("../types").AppServiceRegistrationConfig} reg */
function checkRegistration(reg) {
	assert(reg.msi?.server_name)
}

/* c8 ignore next 4 */
/** @param {import("../types").AppServiceRegistrationConfig} reg */
function writeRegistration(reg) {
	fs.writeFileSync(registrationFilePath, JSON.stringify(reg, null, 2) + "\n")
}

/**
 * @param {string} serverName
 * @returns {import("../types").InitialAppServiceRegistrationConfig} reg
 */
function getTemplateRegistration(serverName) {
	return {
		id: "msi",
		as_token: crypto.randomBytes(32).toString("hex"),
		hs_token: crypto.randomBytes(32).toString("hex"),
		namespaces: {
			users: [{
				exclusive: false,
				regex: `@$.*:${serverName}`
			}]
		},
		rate_limited: false,
		socket: 6667,
		sender_localpart: "_msi_bot",
		msi: {
			data_path: "./data",
			server_name: serverName,
			server_origin: "https://matrix.example.net",
			web_origin: "https://msi.example.net",
			content_length_workaround: false
		}
	}
}

function readRegistration() {
	/** @type {import("../types").AppServiceRegistrationConfig} */ // @ts-ignore
	let result = null
	try {
		const content = fs.readFileSync(registrationFilePath, "utf8")
		result = JSON.parse(content)
	/* c8 ignore next */
	} catch (e) {}
	return result
}

/** @type {import("../types").AppServiceRegistrationConfig} */ // @ts-ignore
let reg = readRegistration()

module.exports.registrationFilePath = registrationFilePath
module.exports.readRegistration = readRegistration
module.exports.getTemplateRegistration = getTemplateRegistration
module.exports.writeRegistration = writeRegistration
module.exports.checkRegistration = checkRegistration
module.exports.reg = reg
