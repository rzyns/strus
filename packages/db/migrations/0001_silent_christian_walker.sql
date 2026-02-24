ALTER TABLE `lexemes` RENAME TO `lemmas`;--> statement-breakpoint
ALTER TABLE `vocab_list_lexemes` RENAME TO `vocab_list_lemmas`;--> statement-breakpoint
ALTER TABLE `vocab_list_lemmas` RENAME COLUMN "lexeme_id" TO "lemma_id";--> statement-breakpoint
ALTER TABLE `lemmas` ADD `source` text DEFAULT 'morfeusz' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_vocab_list_lemmas` (
	`list_id` text NOT NULL,
	`lemma_id` text NOT NULL,
	PRIMARY KEY(`list_id`, `lemma_id`),
	FOREIGN KEY (`list_id`) REFERENCES `vocab_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lemma_id`) REFERENCES `lemmas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_vocab_list_lemmas`("list_id", "lemma_id") SELECT "list_id", "lemma_id" FROM `vocab_list_lemmas`;--> statement-breakpoint
DROP TABLE `vocab_list_lemmas`;--> statement-breakpoint
ALTER TABLE `__new_vocab_list_lemmas` RENAME TO `vocab_list_lemmas`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_learning_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`lemma_id` text NOT NULL,
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
	FOREIGN KEY (`lemma_id`) REFERENCES `lemmas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_learning_targets`("id", "lemma_id", "tag", "state", "due", "stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "last_review") SELECT "id", "lemma_id", "tag", "state", "due", "stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "last_review" FROM `learning_targets`;--> statement-breakpoint
DROP TABLE `learning_targets`;--> statement-breakpoint
ALTER TABLE `__new_learning_targets` RENAME TO `learning_targets`;--> statement-breakpoint
CREATE INDEX `learning_targets_due_idx` ON `learning_targets` (`due`);--> statement-breakpoint
CREATE INDEX `learning_targets_lemma_id_idx` ON `learning_targets` (`lemma_id`);--> statement-breakpoint
CREATE TABLE `__new_morph_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`lemma_id` text NOT NULL,
	`orth` text NOT NULL,
	`tag` text NOT NULL,
	`parsed_tag` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lemma_id`) REFERENCES `lemmas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_morph_forms`("id", "lemma_id", "orth", "tag", "parsed_tag", "created_at") SELECT "id", "lemma_id", "orth", "tag", "parsed_tag", "created_at" FROM `morph_forms`;--> statement-breakpoint
DROP TABLE `morph_forms`;--> statement-breakpoint
ALTER TABLE `__new_morph_forms` RENAME TO `morph_forms`;