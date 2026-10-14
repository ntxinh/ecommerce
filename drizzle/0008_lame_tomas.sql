ALTER TABLE `payment_attempts` ADD `provider_ref` text;--> statement-breakpoint
CREATE INDEX `payment_attempts_provider_ref_idx` ON `payment_attempts` (`provider_ref`);