BEGIN TRANSACTION;

INSERT INTO invite_link (id, room_id, room_name, room_icon, creator_mxid, creator_name, creator_icon, creation_date, expiration_date, max_uses, uses, url) VALUES
('1', '!room1:example.com', 'Room 1', 'room_icon1', 'creator1:example.com', 'creator 1', 'creator_icon1', '1', '10', 100, 20, 'gg?1'),
('2', '!room1:example.com', 'Room 1', 'room_icon1', 'creator1:example.com', 'creator 1', 'creator_icon1', '1', '10', 100, 20, 'gg?1'),
('3', '!room2:example.com', 'Room 2', '', 'creator1:example.com', 'creator 1', 'creator_icon1', '1', '10', 100, 101, 'gg?1'),
('4', '!room2:example.com', 'Room 2', '', 'creator2:example.com', 'creator 2', '', '15', '10', 100, 20, 'gg?1');

INSERT INTO direct (mxid, room_id) VALUES
('@user1:example.com', '!existing:example.com'),
('@user2:example.com', '!existing:example.com');

COMMIT;
