CREATE TABLE `learning_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`lexeme_id` text NOT NULL,
	`tag` text NOT NULL,
	`state` integer DEFAULT 0 NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learning_targets_due_idx` ON `learning_targets` (`due`);--> statement-breakpoint
CREATE INDEX `learning_targets_lexeme_id_idx` ON `learning_targets` (`lexeme_id`);--> statement-breakpoint
CREATE TABLE `lexemes` (
	`id` text PRIMARY KEY NOT NULL,
	`lemma` text NOT NULL,
	`pos` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `morph_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`lexeme_id` text NOT NULL,
	`orth` text NOT NULL,
	`tag` text NOT NULL,
	`parsed_tag` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`learning_target_id` text NOT NULL,
	`rating` integer NOT NULL,
	`state_before` integer NOT NULL,
	`due` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`stability_after` real NOT NULL,
	`difficulty_after` real NOT NULL,
	FOREIGN KEY (`learning_target_id`) REFERENCES `learning_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_learning_target_id_idx` ON `reviews` (`learning_target_id`);--> statement-breakpoint
CREATE TABLE `vocab_list_lexemes` (
	`list_id` text NOT NULL,
	`lexeme_id` text NOT NULL,
	PRIMARY KEY(`list_id`, `lexeme_id`),
	FOREIGN KEY (`list_id`) REFERENCES `vocab_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vocab_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
