BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "invite_link" (
	"id"	TEXT NOT NULL,
	"room_id"	TEXT NOT NULL,
	"room_icon"	TEXT NOT NULL,
	"room_name"	TEXT NOT NULL,
	"creator_mxid"	TEXT NOT NULL,
	"creator_icon"	TEXT,
	"creator_name"	TEXT NOT NULL,
	"creation_date"	NUMBER NOT NULL,
	"expiration_date"	NUMBER NOT NULL,
	"max_uses"	NUMBER NOT NULL,
	"uses"	NUMBER NOT NULL,
	"url"	TEXT NOT NULL,
	PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "direct" (
	"mxid"	TEXT NOT NULL,
	"room_id"	TEXT NOT NULL,
	PRIMARY KEY("mxid")
) WITHOUT ROWID;

COMMIT;
