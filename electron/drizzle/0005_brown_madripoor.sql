CREATE TABLE `provider_sessions` (
	`chat_id` text NOT NULL,
	`provider` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`chat_id`, `provider`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_sessions_payload_json" CHECK(json_valid("provider_sessions"."payload"))
);
