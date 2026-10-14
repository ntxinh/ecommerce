CREATE TABLE `product_moderations` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_moderations_product_idx` ON `product_moderations` (`product_id`);--> statement-breakpoint
ALTER TABLE `products` ADD `moderation_status` text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
CREATE INDEX `products_moderation_idx` ON `products` (`moderation_status`);