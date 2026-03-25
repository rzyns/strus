CREATE TABLE `card_knowledge_components` (
	`card_id` text NOT NULL,
	`kc_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `kc_id`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`) REFERENCES `knowledge_components`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_knowledge_components_kc_id_idx` ON `card_knowledge_components` (`kc_id`);--> statement-breakpoint
CREATE TABLE `knowledge_components` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`label_pl` text,
	`tag_pattern` text,
	`lemma_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lemma_id`) REFERENCES `lemmas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_components_kind_idx` ON `knowledge_components` (`kind`);--> statement-breakpoint
CREATE INDEX `knowledge_components_lemma_id_idx` ON `knowledge_components` (`lemma_id`);