CREATE TABLE `delegated_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_chat_id` text NOT NULL,
	`parent_run_id` text NOT NULL,
	`child_chat_id` text NOT NULL,
	FOREIGN KEY (`parent_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_run_id`) REFERENCES `chat_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_delegated_tasks_parent` ON `delegated_tasks` (`parent_chat_id`);