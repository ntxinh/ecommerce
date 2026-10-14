CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_name_unique` ON `brands` (`name`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`name_en` text NOT NULL,
	`name_vi` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`name_en` text NOT NULL,
	`name_vi` text NOT NULL,
	`attributes_json` text DEFAULT '{}' NOT NULL,
	`base_price_vnd` integer NOT NULL,
	`sale_price_vnd` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_variants_sku_idx` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`category_id` text NOT NULL,
	`brand_id` text,
	`slug` text NOT NULL,
	`name_en` text NOT NULL,
	`name_vi` text NOT NULL,
	`description_en` text DEFAULT '' NOT NULL,
	`description_vi` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_shop_idx` ON `products` (`shop_id`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE TABLE `inventory` (
	`variant_id` text PRIMARY KEY NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_movements_variant_idx` ON `inventory_movements` (`variant_id`);--> statement-breakpoint
CREATE TABLE `stock_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`qty` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`idempotency_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_reservations_expiry_idx` ON `stock_reservations` (`expires_at`,`status`);--> statement-breakpoint
CREATE INDEX `stock_reservations_variant_idx` ON `stock_reservations` (`variant_id`);--> statement-breakpoint
CREATE INDEX `stock_reservations_idem_idx` ON `stock_reservations` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`qty` integer NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_items_unique` ON `cart_items` (`cart_id`,`variant_id`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carts_user_unique` ON `carts` (`user_id`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text DEFAULT 'IN_PROGRESS' NOT NULL,
	`response_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_order_id` text NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`sku_snapshot` text NOT NULL,
	`attrs_json` text DEFAULT '{}' NOT NULL,
	`unit_price_vnd` integer NOT NULL,
	`qty` integer NOT NULL,
	`item_discount_vnd` integer DEFAULT 0 NOT NULL,
	`voucher_discount_vnd` integer DEFAULT 0 NOT NULL,
	`line_total_vnd` integer NOT NULL,
	FOREIGN KEY (`seller_order_id`) REFERENCES `seller_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_product_idx` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `order_pricing_breakdowns` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`line_type` text NOT NULL,
	`amount_vnd` integer NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_pricing_order_idx` ON `order_pricing_breakdowns` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`address_snapshot_json` text NOT NULL,
	`status` text DEFAULT 'PENDING_PAYMENT' NOT NULL,
	`total_vnd` integer NOT NULL,
	`subtotal_vnd` integer NOT NULL,
	`shipping_vnd` integer DEFAULT 0 NOT NULL,
	`discount_vnd` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'VND' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`status` text NOT NULL,
	`simulate` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_attempts_payment_idx` ON `payment_attempts` (`payment_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`amount_vnd` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_order_unique` ON `payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `seller_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`subtotal_vnd` integer NOT NULL,
	`shipping_vnd` integer DEFAULT 0 NOT NULL,
	`commission_rate_bps` integer NOT NULL,
	`tracking_number` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `seller_orders_shop_status_idx` ON `seller_orders` (`shop_id`,`status`);--> statement-breakpoint
CREATE INDEX `seller_orders_order_idx` ON `seller_orders` (`order_id`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_order_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`tracking_number` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`seller_order_id`) REFERENCES `seller_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_seller_order_unique` ON `shipments` (`seller_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_tracking_unique` ON `shipments` (`tracking_number`);--> statement-breakpoint
CREATE TABLE `tracking_events` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`status` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracking_events_shipment_idx` ON `tracking_events` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`product_id` text,
	`shop_id` text,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `promotions_shop_idx` ON `promotions` (`shop_id`);--> statement-breakpoint
CREATE INDEX `promotions_product_idx` ON `promotions` (`product_id`);--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`scope` text NOT NULL,
	`shop_id` text,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`min_spend_vnd` integer DEFAULT 0 NOT NULL,
	`max_discount_vnd` integer,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`total_limit` integer,
	`per_user_limit` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vouchers_code_unique` ON `vouchers` (`code`);