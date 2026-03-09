/**
 * Shared API output types derived from the server-side router via
 * InferRouterOutputs. Import these instead of writing `any` annotations on
 * createResource calls or For iterators.
 *
 * Preferred over Awaited<ReturnType<RouterClient<Router>[...]>> because it
 * operates directly on the server-side Zod schema inference and is the
 * canonical oRPC idiom.
 */
import type { InferRouterOutputs } from '@orpc/server'
import type { Router } from '@rzyns/strus-api/router'

type RouterOutputs = InferRouterOutputs<Router>

// ---------------------------------------------------------------------------
// Lemmas
// ---------------------------------------------------------------------------

export type LemmaItem = RouterOutputs['lemmas']['list'][number]
export type LemmaDetail = RouterOutputs['lemmas']['get']
export type MorphFormItem = RouterOutputs['lemmas']['forms'][number]

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export type NoteListItem = RouterOutputs['notes']['list'][number]
export type NoteDetail = RouterOutputs['notes']['get']
export type CardItem = NoteDetail['cards'][number]

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewItem = RouterOutputs['cards']['reviews'][number]

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type DueCard = RouterOutputs['session']['due'][number]

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type VocabListItem = RouterOutputs['lists']['list'][number]

// ---------------------------------------------------------------------------
// Draft notes (review queue)
// ---------------------------------------------------------------------------

export type DraftNoteItem = RouterOutputs['notes']['listDrafts']['notes'][number]
