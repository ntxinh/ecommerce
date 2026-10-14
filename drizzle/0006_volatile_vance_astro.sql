CREATE TABLE `search_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`query` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `search_history_user_created_idx` ON `search_history` (`user_id`,`created_at`);