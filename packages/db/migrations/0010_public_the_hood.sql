CREATE TABLE `choice_options` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`option_text` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	`explanation` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cloze_gaps` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`gap_index` integer NOT NULL,
	`correct_answers` text NOT NULL,
	`hint` text,
	`concept_id` text,
	`difficulty` integer,
	`explanation` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`concept_id`) REFERENCES `grammar_concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `grammar_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `grammar_concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `semantic_cluster_members` (
	`cluster_id` text NOT NULL,
	`lemma_id` text NOT NULL,
	`role` text,
	PRIMARY KEY(`cluster_id`, `lemma_id`),
	FOREIGN KEY (`cluster_id`) REFERENCES `semantic_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lemma_id`) REFERENCES `lemmas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `semantic_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cluster_type` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sentence_concepts` (
	`sentence_id` text NOT NULL,
	`concept_id` text NOT NULL,
	PRIMARY KEY(`sentence_id`, `concept_id`),
	FOREIGN KEY (`sentence_id`) REFERENCES `sentences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`concept_id`) REFERENCES `grammar_concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sentences` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`translation` text,
	`source` text DEFAULT 'handcrafted' NOT NULL,
	`difficulty` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cards` ADD `gap_id` text REFERENCES cloze_gaps(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `sentence_id` text REFERENCES sentences(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `concept_id` text REFERENCES grammar_concepts(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `cluster_id` text REFERENCES semantic_clusters(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `explanation` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `status` text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD `generation_meta` text;