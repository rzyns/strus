PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_knowledge_components` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`label_pl` text,
	`tag_pattern` text,
	`lemma_id` text,
	`state` integer DEFAULT 0 NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lemma_id`) REFERENCES `lemmas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_components`(
	`id`,
	`kind`,
	`label`,
	`label_pl`,
	`tag_pattern`,
	`lemma_id`,
	`state`,
	`due`,
	`stability`,
	`difficulty`,
	`elapsed_days`,
	`scheduled_days`,
	`reps`,
	`lapses`,
	`last_review`,
	`created_at`
)
SELECT
	`id`,
	`kind`,
	`label`,
	`label_pl`,
	`tag_pattern`,
	`lemma_id`,
	0,
	unixepoch(),
	0,
	0,
	0,
	0,
	0,
	0,
	NULL,
	`created_at`
FROM `knowledge_components`;--> statement-breakpoint
DROP TABLE `knowledge_components`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_components` RENAME TO `knowledge_components`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `knowledge_components_kind_idx` ON `knowledge_components` (`kind`);--> statement-breakpoint
CREATE INDEX `knowledge_components_lemma_id_idx` ON `knowledge_components` (`lemma_id`);
