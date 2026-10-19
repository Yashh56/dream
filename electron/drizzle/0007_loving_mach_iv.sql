CREATE TABLE `device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_name` text NOT NULL,
	`client_kind` text NOT NULL,
	`scopes` text NOT NULL,
	`verifier` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	CONSTRAINT "device_sessions_scopes_json" CHECK(json_valid("device_sessions"."scopes"))
);
