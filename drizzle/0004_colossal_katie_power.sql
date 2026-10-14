CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`phone` text NOT NULL,
	`line1` text NOT NULL,
	`ward` text NOT NULL,
	`district` text NOT NULL,
	`city` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `addresses_user_idx` ON `addresses` (`user_id`);