CREATE TABLE `voucher_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`voucher_id` text NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`voucher_id`) REFERENCES `vouchers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voucher_redemptions_voucher_user_idx` ON `voucher_redemptions` (`voucher_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `voucher_redemptions_voucher_order_unique` ON `voucher_redemptions` (`voucher_id`,`order_id`);