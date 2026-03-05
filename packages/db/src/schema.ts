import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime("now"))`),
});

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
  /** Relative path to generated mnemonic image, e.g. "images/dom.png" */
  imagePath: text("image_path"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

export const notes = sqliteTable("notes", {
  id:        text("id").primaryKey(),
  /** 'morph' | 'gloss' | 'basic' */
  kind:      text("kind", { enum: ["morph", "gloss", "basic"] }).notNull(),
  /** Populated for kind='morph' and kind='gloss'; null for kind='basic' */
  lemmaId:   text("lemma_id").references(() => lemmas.id, { onDelete: "cascade" }),
  /** For kind='gloss' and kind='basic': the prompt text shown to the user */
  front:     text("front"),
  /** For kind='gloss' and kind='basic': the answer text revealed to the user */
  back:      text("back"),
  /** Unix timestamp (seconds) — last time any card under this note was reviewed */
  lastReviewedAt: integer("last_reviewed_at"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// vocabListNotes  (join table)
// ---------------------------------------------------------------------------

export const vocabListNotes = sqliteTable(
  "vocab_list_notes",
  {
    listId: text("list_id")
      .notNull()
      .references(() => vocabLists.id, { onDelete: "cascade" }),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.listId, t.noteId] })],
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
  /** Relative path to generated TTS audio file, e.g. "audio/dom-subst-sg-nom-m3.mp3" */
  audioPath: text("audio_path"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// cards
// ---------------------------------------------------------------------------

export const cards = sqliteTable(
  "cards",
  {
    id:            text("id").primaryKey(),
    noteId:        text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    /** 'morph_form' | 'gloss_forward' | 'gloss_reverse' | 'basic_forward' */
    kind:          text("kind", { enum: ["morph_form", "gloss_forward", "gloss_reverse", "basic_forward"] }).notNull().default("morph_form"),
    /** Morphosyntactic tag — only set for kind='morph_form' */
    tag:           text("tag"),
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
    index("cards_due_idx").on(t.due),
    index("cards_note_id_idx").on(t.noteId),
  ],
);

// ---------------------------------------------------------------------------
// reviews
// ---------------------------------------------------------------------------

export const reviews = sqliteTable(
  "reviews",
  {
    id:               text("id").primaryKey(),
    cardId:           text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
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
    index("reviews_card_id_idx").on(t.cardId),
  ],
);
