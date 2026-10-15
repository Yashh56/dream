CREATE TABLE `chat_message_text` (
	`message_row` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`text` text NOT NULL
);
--> statement-breakpoint
-- Written beside each message by the save path (saveChatMessages in
-- electron/host/catalog-store.js); removed with its message however that
-- goes, a chat or project removal's cascade included. The text parts of a
-- message are those its payload lists under `parts` with `type` "text"
-- and a string `text`, joined by U+001F in order. What is stored already
-- is backfilled below.
CREATE TRIGGER `chat_messages_text_delete` AFTER DELETE ON `chat_messages` BEGIN
	DELETE FROM `chat_message_text` WHERE `message_row` = OLD.`id`;
END;--> statement-breakpoint
INSERT INTO `chat_message_text` (`message_row`, `message_id`, `text`)
SELECT `id`, `message_id`, `text`
FROM (
	SELECT m.`id` AS `id`, CASE WHEN json_type(m.`payload`, '$.id') = 'text' THEN m.`payload` ->> '$.id' END AS `message_id`, (
		SELECT group_concat(CASE WHEN j.type = 'object' THEN j.value ->> '$.text' END, char(31) ORDER BY j.key)
		FROM json_each(CASE WHEN json_type(m.`payload`, '$.parts') = 'array' THEN m.`payload` END, '$.parts') AS j
		WHERE CASE WHEN j.type = 'object' THEN (j.value ->> '$.type') = 'text' AND json_type(j.value, '$.text') = 'text' END
	) AS `text`
	FROM `chat_messages` AS m
)
WHERE `text` IS NOT NULL;
