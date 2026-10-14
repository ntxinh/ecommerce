ALTER TABLE `payment_attempts` ADD `external_ref` text;--> statement-breakpoint
CREATE INDEX `payment_attempts_external_ref_idx` ON `payment_attempts` (`external_ref`);