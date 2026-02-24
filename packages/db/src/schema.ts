import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// vocabLists
// ---------------------------------------------------------------------------

export const vocabLists = sqliteTable("vocab_lists", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  description: text("description"),
  createdAt:   integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// lemmas
// ---------------------------------------------------------------------------

export const lemmas = sqliteTable("lemmas", {
  id:        text("id").primaryKey(),
  /** The citation/dictionary form, e.g. "dom", "iść", "dobry" */
  lemma:     text("lemma").notNull(),
  pos:       text("pos").notNull(),
  /** How the paradigm was populated: morfeusz = auto-generated, manual = user-supplied */
  source:    text("source", { enum: ["morfeusz", "manual"] }).notNull().default("morfeusz"),
  notes:     text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// vocabListLemmas  (join table)
// ---------------------------------------------------------------------------

export const vocabListLemmas = sqliteTable(
  "vocab_list_lemmas",
  {
    listId:  text("list_id")
      .notNull()
      .references(() => vocabLists.id, { onDelete: "cascade" }),
    lemmaId: text("lemma_id")
      .notNull()
      .references(() => lemmas.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.listId, t.lemmaId] })],
);

// ---------------------------------------------------------------------------
// morphForms
// ---------------------------------------------------------------------------

export const morphForms = sqliteTable("morph_forms", {
  id:        text("id").primaryKey(),
  lemmaId:   text("lemma_id")
    .notNull()
    .references(() => lemmas.id, { onDelete: "cascade" }),
  orth:      text("orth").notNull(),
  tag:       text("tag").notNull(),
  /** JSON-serialised ParsedTag */
  parsedTag: text("parsed_tag").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// learningTargets
// ---------------------------------------------------------------------------

export const learningTargets = sqliteTable(
  "learning_targets",
  {
    id:            text("id").primaryKey(),
    lemmaId:       text("lemma_id")
      .notNull()
      .references(() => lemmas.id, { onDelete: "cascade" }),
    tag:           text("tag").notNull(),
    /** CardState enum value (0=New,1=Learning,2=Review,3=Relearning) */
    state:         integer("state").notNull().default(0),
    /** Unix timestamp (seconds) */
    due:           integer("due").notNull(),
    stability:     real("stability").notNull().default(0),
    difficulty:    real("difficulty").notNull().default(0),
    elapsedDays:   integer("elapsed_days").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    reps:          integer("reps").notNull().default(0),
    lapses:        integer("lapses").notNull().default(0),
    /** Unix timestamp (seconds), nullable */
    lastReview:    integer("last_review"),
  },
  (t) => [
    index("learning_targets_due_idx").on(t.due),
    index("learning_targets_lemma_id_idx").on(t.lemmaId),
  ],
);

// ---------------------------------------------------------------------------
// reviews
// ---------------------------------------------------------------------------

export const reviews = sqliteTable(
  "reviews",
  {
    id:               text("id").primaryKey(),
    learningTargetId: text("learning_target_id")
      .notNull()
      .references(() => learningTargets.id, { onDelete: "cascade" }),
    /** Rating enum value (1=Again,2=Hard,3=Good,4=Easy) */
    rating:           integer("rating").notNull(),
    /** CardState before the review */
    stateBefore:      integer("state_before").notNull(),
    /** Unix timestamp — when this card was due */
    due:              integer("due").notNull(),
    /** Unix timestamp — when the review actually happened */
    reviewedAt:       integer("reviewed_at").notNull(),
    elapsedDays:      integer("elapsed_days").notNull(),
    scheduledDays:    integer("scheduled_days").notNull(),
    stabilityAfter:   real("stability_after").notNull(),
    difficultyAfter:  real("difficulty_after").notNull(),
  },
  (t) => [
    index("reviews_learning_target_id_idx").on(t.learningTargetId),
  ],
);
