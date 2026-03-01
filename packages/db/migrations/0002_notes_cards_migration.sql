-- Migration: Notes/Cards schema migration
-- Introduces notes table, renames learning_targets → cards, vocab_list_lemmas → vocab_list_notes,
-- and reviews.learning_target_id → reviews.card_id. Backfills morph notes for all existing lemmas.

-- Step 1: Create notes table
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`lemma_id` text,
	`front` text,
	`back` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lemma_id`) REFERENCES `lemmas`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- Step 2: Backfill — create one morph note per existing lemma
INSERT INTO `notes` (`id`, `kind`, `lemma_id`, `front`, `back`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
	'morph',
	id,
	NULL,
	NULL,
	created_at,
	updated_at
FROM `lemmas`;--> statement-breakpoint

-- Step 3: Rename learning_targets → cards (with schema changes: lemma_id → note_id, add kind column)
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`kind` text DEFAULT 'morph_form' NOT NULL,
	`tag` text,
	`state` integer DEFAULT 0 NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_cards`(`id`, `note_id`, `kind`, `tag`, `state`, `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `last_review`)
SELECT
	lt.`id`,
	n.`id`,
	'morph_form',
	lt.`tag`,
	lt.`state`,
	lt.`due`,
	lt.`stability`,
	lt.`difficulty`,
	lt.`elapsed_days`,
	lt.`scheduled_days`,
	lt.`reps`,
	lt.`lapses`,
	lt.`last_review`
FROM `learning_targets` lt
INNER JOIN `notes` n ON n.`lemma_id` = lt.`lemma_id` AND n.`kind` = 'morph';--> statement-breakpoint
DROP TABLE `learning_targets`;--> statement-breakpoint
ALTER TABLE `__new_cards` RENAME TO `cards`;--> statement-breakpoint
CREATE INDEX `cards_due_idx` ON `cards` (`due`);--> statement-breakpoint
CREATE INDEX `cards_note_id_idx` ON `cards` (`note_id`);--> statement-breakpoint

-- Step 4: Rename vocab_list_lemmas → vocab_list_notes (lemma_id → note_id via morph note lookup)
CREATE TABLE `__new_vocab_list_notes` (
	`list_id` text NOT NULL,
	`note_id` text NOT NULL,
	PRIMARY KEY(`list_id`, `note_id`),
	FOREIGN KEY (`list_id`) REFERENCES `vocab_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_vocab_list_notes`(`list_id`, `note_id`)
SELECT
	vll.`list_id`,
	n.`id`
FROM `vocab_list_lemmas` vll
INNER JOIN `notes` n ON n.`lemma_id` = vll.`lemma_id` AND n.`kind` = 'morph';--> statement-breakpoint
DROP TABLE `vocab_list_lemmas`;--> statement-breakpoint
ALTER TABLE `__new_vocab_list_notes` RENAME TO `vocab_list_notes`;--> statement-breakpoint

-- Step 5: Rename reviews.learning_target_id → reviews.card_id
CREATE TABLE `__new_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`rating` integer NOT NULL,
	`state_before` integer NOT NULL,
	`due` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`stability_after` real NOT NULL,
	`difficulty_after` real NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_reviews`(`id`, `card_id`, `rating`, `state_before`, `due`, `reviewed_at`, `elapsed_days`, `scheduled_days`, `stability_after`, `difficulty_after`)
SELECT `id`, `learning_target_id`, `rating`, `state_before`, `due`, `reviewed_at`, `elapsed_days`, `scheduled_days`, `stability_after`, `difficulty_after` FROM `reviews`
WHERE `learning_target_id` IN (SELECT `id` FROM `cards`);--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
CREATE INDEX `reviews_card_id_idx` ON `reviews` (`card_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
