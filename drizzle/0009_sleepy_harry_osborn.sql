CREATE TABLE `financial_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`shop_id` text,
	`amount_vnd` integer NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_account_idx` ON `financial_ledger_entries` (`account`,`shop_id`);--> statement-breakpoint
CREATE INDEX `ledger_ref_idx` ON `financial_ledger_entries` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `seller_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`gross_vnd` integer NOT NULL,
	`commission_vnd` integer NOT NULL,
	`refund_vnd` integer DEFAULT 0 NOT NULL,
	`net_vnd` integer NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `settlements_shop_idx` ON `seller_settlements` (`shop_id`,`status`);--> statement-breakpoint
CREATE TABLE `settlement_items` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_id` text NOT NULL,
	`seller_order_id` text NOT NULL,
	`gross_vnd` integer NOT NULL,
	`commission_vnd` integer NOT NULL,
	`net_vnd` integer NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `seller_settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seller_order_id`) REFERENCES `seller_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_items_so_uidx` ON `settlement_items` (`seller_order_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`return_item_id` text,
	`amount_vnd` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`return_item_id`) REFERENCES `return_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_return_item_uidx` ON `refunds` (`return_item_id`);--> statement-breakpoint
CREATE TABLE `return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_request_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`restock` integer DEFAULT false NOT NULL,
	`refund_vnd` integer NOT NULL,
	FOREIGN KEY (`return_request_id`) REFERENCES `return_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `return_items_req_idx` ON `return_items` (`return_request_id`);--> statement-breakpoint
CREATE TABLE `return_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_order_id` text NOT NULL,
	`order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`reason` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`seller_order_id`) REFERENCES `seller_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `return_requests_so_idx` ON `return_requests` (`seller_order_id`,`status`);--> statement-breakpoint
CREATE INDEX `return_requests_user_idx` ON `return_requests` (`user_id`);--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`wishlist_id` text NOT NULL,
	`product_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wishlist_id`) REFERENCES `wishlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_items_uidx` ON `wishlist_items` (`wishlist_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `wishlists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishlists_user_id_unique` ON `wishlists` (`user_id`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`user_id`, `type`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`href` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
ALTER TABLE `reviews` ADD `images_json` text DEFAULT '[]' NOT NULL;