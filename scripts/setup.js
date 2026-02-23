#!/usr/bin/env node
// @ts-check

const Ty = require("../src/types")
const fs = require("fs")
const sqlite = require("better-sqlite3")
const {scheduler} = require("timers/promises")
const {isDeepStrictEqual} = require("util")
const {createServer} = require("http")
const {join} = require("path")

const {prompt} = require("enquirer")
const Input = require("enquirer/lib/prompts/input")
const {magenta, bold, cyan} = require("ansi-colors")
const HeatSync = require("heatsync")
const {createApp, defineEventHandler, toNodeListener} = require("h3")

let registration = require("../src/matrix/read-registration")
let {reg, getTemplateRegistration, writeRegistration, readRegistration, checkRegistration, registrationFilePath} = registration
const migrate = require("../src/db/migrate")

const passthrough = require("../src/passthrough")
const assert = require("assert")
const sync = new HeatSync({watchFS: false})

async function suggestWellKnown(serverUrlPrompt, url, otherwise) {
	try {
		var json = await fetch(`${url}/.well-known/matrix/client`).then(res => res.json())
		let baseURL = json["m.homeserver"].base_url.replace(/\/$/, "")
		if (baseURL && baseURL !== url) {
			serverUrlPrompt.initial = baseURL
			return `Did you mean: ${bold(baseURL)}? (Enter to accept)`
		}
	} catch (e) {}
	return otherwise
}

async function validateHomeserverOrigin(serverUrlPrompt, url) {
	if (!url.match(/^https?:\/\//)) return "Must be a URL"
	if (url.match(/\/$/)) return "Must not end with a slash"
	process.stdout.write(magenta(" checking, please wait..."))
	try {
		var res = await fetch(`${url}/_matrix/client/versions`)
		if (res.status !== 200) {
			return suggestWellKnown(serverUrlPrompt, url, `There is no Matrix server at that URL (${url}/_matrix/client/versions returned ${res.status})`)
		}
	} catch (e) {
		return e.message
	}
	try {
		/** @type {any} */
		var json = await res.json()
		if (!Array.isArray(json?.versions) || !json.versions.includes("v1.11")) {
			return `MSI needs Matrix version v1.11, but ${url} doesn't support this`
		}
	} catch (e) {
		return suggestWellKnown(serverUrlPrompt, url, `There is no Matrix server at that URL (${url}/_matrix/client/versions is not JSON)`)
	}
	return true
}

function defineEchoHandler() {
	return defineEventHandler(event => {
		return "Matrix Simple Invite is listening.\n" +
			`Received a ${event.method} request on path ${event.path}\n`
	})
}

;(async () => {
	// create registration file with prompts...
	if (!reg) {
		console.log("What is the name of your homeserver? This is the part after : in your username.")
		/** @type {{server_name: string}} */
		const serverNameResponse = await prompt({
			type: "input",
			name: "server_name",
			message: "Homeserver name",
			validate: serverName => !!serverName.match(/[a-z0-9][.a-z0-9-]+[a-z]/)
		})

		console.log("What is the URL of your homeserver?")
		const serverOriginPrompt = new Input({
			type: "input",
			name: "server_origin",
			message: "Homeserver URL",
			initial: () => `https://${serverNameResponse.server_name}`,
			validate: url => validateHomeserverOrigin(serverOriginPrompt, url)
		})

		/** @type {string} */ // @ts-ignore
		const serverOrigin = await serverOriginPrompt.run()

		console.log("MSI has its own web server. It needs to be accessible on the public internet.")
		console.log("What port would you like OOYE to use? You can connect your reverse proxy to this port later.")
		/** @type {{socket: string | number}} */
		const portResponse = await prompt({
			type: "input",
			name: "socket",
			message: "Web server port",
			initial: "6661"
		})
		portResponse.socket = +portResponse.socket || portResponse.socket // convert to number if numeric

		const app = createApp()
		app.use(defineEchoHandler())
		const server = createServer(toNodeListener(app))
		await server.listen(portResponse.socket)

		console.log("Now you need to enter a public URL that MSI's web server will live on.")
		console.log("Set up your reverse proxy so that this URL accesses MSI.")
		console.log("Examples: https://github.com/vrisalab/matrix-simple-invite/tree/main?tab=readme-ov-file#proxying-msi")
		if (typeof portResponse.socket === "number") {
			console.log(`Now listening on http://localhost:${portResponse.socket}. Feel free to send some test requests.`)
		}
		/** @type {{web_origin: string}} */
		const webOriginResponse = await prompt({
			type: "input",
			name: "web_origin",
			message: "URL to reach MSI",
			initial: () => `https://msi.${serverNameResponse.server_name}`,
			validate: async url => {
				process.stdout.write(magenta(" checking, please wait..."))
				try {
					const res = await fetch(url)
					if (res.status !== 200) return `Server returned status code ${res.status}`
					const text = await res.text()
                    console.log(text)
					if (!text.startsWith("Matrix Simple Invite is listening.")) return `Server does not point to MSI`
					return true
				} catch (e) {
					return e.message
				}
			}
		})
		webOriginResponse.web_origin = webOriginResponse.web_origin.replace(/\/+$/, "") // remove trailing slash

		await server.close()

		console.log("Would you like to require a password to create invite links?")
		/** @type {{web_password: string}} */
		const passwordResponse = await prompt({
			type: "text",
			name: "web_password",
			message: "Choose a simple password (optional)"
		})

		const template = getTemplateRegistration(serverNameResponse.server_name)
		reg = {
			...template,
			url: webOriginResponse.web_origin,
			...portResponse,
			msi: {
				...template.msi,
				...webOriginResponse,
				...passwordResponse,
				server_origin: serverOrigin,
                data_path: "./data"
			}
		}
		registration.reg = reg
		checkRegistration(reg)
		writeRegistration(reg)
		console.log(`✅ Your responses have been saved as ${registrationFilePath}`)
	} else {
		try {
			checkRegistration(reg)
			console.log(`✅ Skipped questions - reusing data from ${registrationFilePath}`)
		} catch (e) {
			console.log(`❌ Failed to reuse data from ${registrationFilePath}`)
			console.log("Consider deleting this file. You can re-run setup to safely make a new one.")
			console.log("")
			console.log(e.toString().replace(/^ *\n/gm, ""))
			process.exit(1)
		}
	}

    // Initialize database and files
    fs.mkdirSync(join(reg.msi.data_path, "media"), { recursive: true, })
    fs.mkdirSync("./static", { recursive: true, })

    const db = new sqlite(join(reg.msi.data_path, "msi.db"))
    Object.assign(passthrough, {sync, db})

	await migrate.migrate(db)
	console.log("✅ Database is ready...")

	console.log(`  In ${cyan("Synapse")}, you need to reference that file in your homeserver.yaml and ${cyan("restart Synapse")}.`)
	console.log("    https://element-hq.github.io/synapse/latest/application_services.html")
	console.log(`  In ${cyan("Conduit")}, you need to send the file contents to the #admins room.`)
	console.log("    https://docs.conduit.rs/appservices.html")
	console.log()

    // Verify registration is done
	const api = require("../src/matrix/api")
	const mreq = require("../src/matrix/mreq")

	const {as} = require("../src/matrix/appservice")
	as.router.use("/**", defineEchoHandler())
	await as.listen()

	console.log("⏳ Waiting for you to register the file with your homeserver... (Ctrl+C to cancel)")
	process.once("SIGINT", () => {
		console.log("(Ctrl+C) Quit early. Please re-run setup later and allow it to complete.")
		process.exit(1)
	})

	let itWorks = false
	let lastError = null
	do {
		const result = await api.ping().catch(e => ({ok: false, status: "net", root: e.message}))
		// If it didn't work, log details and retry after some time
		itWorks = result.ok
		if (!itWorks) {
			// Log the full error data if the error is different to last time
			if (!isDeepStrictEqual(lastError, result.root)) {
				if (typeof result.root === "string") {
					console.log(`\nCannot reach homeserver: ${result.root}`)
				} else if (result.root.error) {
					console.log(`\nHomeserver said: [${result.status}] ${result.root.error}`)
				} else {
					console.log(`\nHomeserver said: [${result.status}] ${JSON.stringify(result.root)}`)
				}
				lastError = result.root
			} else {
				process.stderr.write(".")
			}
			await scheduler.wait(5000)
		}
	} while (!itWorks)
	console.log("")

	as.close().catch(() => {})

	// set profile data on homeserver...
	const mxid = `@${reg.sender_localpart}:${reg.msi.server_name}`
	

	console.log("⏩ Updating Matrix profile... (If you've joined lots of rooms, this is slow. Please allow at least 30 seconds.)")
	console.log("If you want the bot to have a custom avatar, please put it in static with the name 'bot-icon.png' before proceeding")
	/** @type {{display_name: string}} */
	const botDisplayNameResponse = await prompt({
		type: "input",
		name: "display_name",
		message: "Display name for the bot",
		initial: () => `MSI`,
		validate: async display_name => {
			if (display_name.length > 500){
				return "Name is too long."
			}
			return true
		}
	})
	await api.profileSetDisplayname(mxid, botDisplayNameResponse.display_name)

	// Upload avatar
	const botIconLocation = join(__dirname, "..", "static", "bot-icon.png")
	let avatarUrl
	if (fs.existsSync(botIconLocation)){
		const avatarBuffer = await fs.promises.readFile(botIconLocation, null)
		/** @type {Ty.R.FileUploaded} */
		const root = await mreq.mreq("POST", "/media/v3/upload", avatarBuffer, {
			headers: {"Content-Type": "image/png"}
		})
		avatarUrl = root.content_uri
		assert(avatarUrl)
	}
	await api.profileSetAvatarUrl(mxid, avatarUrl)
	console.log("✅ Matrix profile updated...")
    

	console.log(`Done! The web interface is available on ${reg.msi.web_origin}. Happy inviting!`)
	process.exit()
})()