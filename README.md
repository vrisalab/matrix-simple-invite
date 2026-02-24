# Matrix simple invite
Simple room and space invites for private and public matrix rooms, with an easy to use web interface, both for inviters and invitees.

Most functionality is heavily based on [Out Of Your Element](https://gitdab.com/cadence/out-of-your-element), created by @cadence:cadence.moe. I really liked the bridge's web interface and it already had a kind of "invite by mxid" functionality, so I figured it was a good start.

# Usage

1. Invite `@_msi_bot:example.com` to the room you want to create invite links for. Make sure both you and the bot have invite permissions to the room.
2. In the web interface, you can paste a room identifier in the specified format, configure the expiration date and number of uses.
3. Copy the invite link and share!
4. You can manage all your invite links clicking on the "Manage Links" button. Click the "X" icon to delete an invite link.

People you send the link to will have to login via Matrix, by clicking on a verification link sent to them by the bot. After that, accepting an invite will trigger a Matrix invite from the bot to the invitee, which they will have to manually accept.
You can test the invitee user experience by joining the oficial channel with this [invite link](https://msi.vtubeando.net/gg?id=ea5fdb34).

# Setup
If you have any issues or questions, message me directly on [@v_risalab:vtubeando.net](https://matrix.to/#/@v_risalab:vtubeando.net) or join the official channel via [#msi:vtubeando.net](https://matrix.to/#/#msi:vtubeando.net)

You'll need:

* Administrative access to a homeserver
* Domain name for the web interface
* Reverse proxy for that domain - an interactive process will help you set this up!

Follow these steps:

1. [Get Node.js version 22 or later](https://nodejs.org/en/download/prebuilt-installer). If you're on Linux, you may prefer to install through system's package manager, though Debian and Ubuntu have hopelessly out of date packages.

1. Switch to a normal user account. (i.e. do not run any of the following commands as root or sudo.)

1. Clone this repo and checkout a specific tag. (Development happens on main. Stable versions are tagged.)

1. Install dependencies: `npm install`

1. Run `npm run setup` to check your setup and set the bot's initial state. You only need to run this once ever. This command will guide you precisely through the following steps:

	* First, you'll be asked for information like your homeserver URL.

	* Then you'll be prompted to set up a reverse proxy pointing from your domain to the bridge's web server. Sample configurations can be found at the end of this guide. It will check that the reverse proxy works before you continue.

	* A registration.yaml file will be generated, which you need to give to your homeserver. You'll be told how to do this. It will check that it's done properly.
    
    * You will be prompted to change the bot's display name. Before setting the name, you can also set an avatar by putting it in `static/bot-icon.png`

1. Start the bridge: `npm run start`

## Update

New versions are alisted on [releases](https://github.com/vrisalab/matrix-simple-invite/releases). Here's how to update:

1. Fetch the repo and checkout the latest release tag.

1. Install dependencies: `npm install`

1. Restart the bridge: Stop the currently running process, and then start the new one with `npm run start`


# Screeshots
<img src="/docs/img/home.png" width="600" />
<img src="/docs/img/links.png" width="600" />
<img src="/docs/img/invite.png" width="600" />

----
<br><br>

# Proxying MSI

## Example reverse proxy for nginx, dedicated domain name

Replace `msi.example.net` with the hostname you're using.

```nix
server {
	listen 80;
	listen [::]:80;
	server_name msi.example.net;

	return 301 https://msi.example.net$request_uri;
}

server {
	listen 443 ssl http2;
	listen [::]:443 ssl http2;
	server_name msi.example.net;

	# ssl parameters here...
	client_max_body_size 5M;

	location / {
		add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
		proxy_pass http://127.0.0.1:6661;
	}
}
```

## Example reverse proxy for nginx, sharing a domain name

Same as above, but change the following:

- `location / {` -> `location /ooye/ {` (any sub-path you want; you MUST use a trailing slash or it won't work)
- `proxy_pass http://127.0.0.1:6691;` -> `proxy_pass http://127.0.0.1:6691/;` (you MUST use a trailing slash on this too or it won't work)

## Example reverse proxy for Caddy, dedicated domain name

```nix
msi.example.net {
	log {
		output file /var/log/caddy/access.log
		format console
	}
	encode gzip
	reverse_proxy 127.0.0.1:6661
}
```
