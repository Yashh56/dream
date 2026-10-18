CREATE TABLE `chat_queues` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`request` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_runs_request_json" CHECK(json_valid("chat_runs"."request"))
);
--> statement-breakpoint
CREATE INDEX `idx_chat_runs_queue` ON `chat_runs` (`chat_id`,`status`,`position`);