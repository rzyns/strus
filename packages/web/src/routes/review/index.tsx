import {
  createSignal,
  createMemo,
  createEffect,
  createResource,
  For,
  Show,
  Switch,
  Match,
  onMount,
  onCleanup,
} from 'solid-js'
import { A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import type { DraftNoteItem } from '../../api/types'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Spinner } from '../../components/Spinner'
import { ErrorState } from '../../components/ErrorState'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DraftNote = DraftNoteItem

type ReviewPhase = 'reviewing' | 'reasoning' | 'submitting' | 'done' | 'error'

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const kindColors: Record<string, { bg: string; color: string }> = {
  cloze:      { bg: 'blue.3',   color: 'blue.11' },
  choice:     { bg: 'purple.3', color: 'purple.11' },
  error:      { bg: 'red.3',    color: 'red.11' },
  classifier: { bg: 'amber.3',  color: 'amber.11' },
}

function KindBadge(props: { kind: string }) {
  const colors = () => kindColors[props.kind] ?? { bg: 'gray.3', color: 'gray.11' }
  return (
    <span class={css({
      display: 'inline-block',
      px: '2',
      py: '0.5',
      borderRadius: 'l2',
      fontSize: 'xs',
      fontWeight: 'semibold',
      textTransform: 'uppercase',
      letterSpacing: 'wider',
      bg: colors().bg,
      color: colors().color,
    })}>
      {props.kind}
    </span>
  )
}

function FlaggedBadge() {
  return (
    <span class={css({
      display: 'inline-block',
      px: '2',
      py: '0.5',
      borderRadius: 'l2',
      fontSize: 'xs',
      fontWeight: 'semibold',
      textTransform: 'uppercase',
      letterSpacing: 'wider',
      bg: 'orange.3',
      color: 'orange.11',
    })}>
      Flagged
    </span>
  )
}

// ---------------------------------------------------------------------------
// Note renderers — per kind
// ---------------------------------------------------------------------------

function ClozeNote(props: { note: DraftNote }) {
  const gaps = () => props.note.gaps ?? []

  // Build a map from gapIndex -> first correct answer
  const gapAnswers = () => {
    const map: Record<number, string> = {}
    for (const g of gaps()) {
      try {
        const answers = JSON.parse(g.correctAnswers) as string[]
        map[g.gapIndex] = answers[0] ?? '?'
      } catch {
        map[g.gapIndex] = g.correctAnswers
      }
    }
    return map
  }

  // Parse the sentence into text and gap segments
  const parts = () => {
    const sentence = props.note.sentenceText ?? ''
    const result: Array<{ type: 'text'; text: string } | { type: 'gap'; index: number }> = []
    const regex = /\{\{(\d+)\}\}/g
    let last = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(sentence)) !== null) {
      if (match.index > last) result.push({ type: 'text', text: sentence.slice(last, match.index) })
      result.push({ type: 'gap', index: parseInt(match[1]!) })
      last = regex.lastIndex
    }
    if (last < sentence.length) result.push({ type: 'text', text: sentence.slice(last) })
    return result
  }

  return (
    <div>
      <p class={css({ fontSize: 'lg', lineHeight: '2', mb: '4' })}>
        <For each={parts()}>
          {(part) => (
            <>
              {part.type === 'text' ? (
                <span>{part.text}</span>
              ) : (
                <span class={css({
                  display: 'inline-block',
                  px: '2',
                  py: '0.5',
                  mx: '0.5',
                  borderRadius: 'l2',
                  bg: 'green.3',
                  color: 'green.11',
                  fontWeight: 'semibold',
                  fontSize: 'sm',
                })}>
                  {gapAnswers()[part.index] ?? '?'}
                </span>
              )}
            </>
          )}
        </For>
      </p>

      {/* Per-gap explanations */}
      <For each={gaps()}>
        {(gap) => (
          <Show when={gap.explanation}>
            {(exp) => (
              <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                Gap {gap.gapIndex}: {exp()}
              </p>
            )}
          </Show>
        )}
      </For>

      <Show when={props.note.explanation}>
        {(exp) => (
          <p class={css({ mt: '3', fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>
            {exp()}
          </p>
        )}
      </Show>
    </div>
  )
}

function ChoiceNote(props: { note: DraftNote }) {
  const options = () => props.note.options ?? []

  return (
    <div>
      <Show when={props.note.sentenceText}>
        {(text) => (
          <p class={css({ fontSize: 'md', fontStyle: 'italic', color: 'fg.muted', mb: '3' })}>
            "{text()}"
          </p>
        )}
      </Show>

      <Show when={props.note.front}>
        {(prompt) => (
          <p class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '4' })}>
            {prompt()}
          </p>
        )}
      </Show>

      <div class={css({ display: 'flex', flexDir: 'column', gap: '2' })}>
        <For each={options()}>
          {(option) => (
            <div class={css({
              p: '3',
              borderRadius: 'l2',
              border: '1px solid',
              borderColor: option.isCorrect ? 'green.7' : 'border',
              bg: option.isCorrect ? 'green.2' : 'bg.subtle',
            })}>
              <span class={css({ fontWeight: option.isCorrect ? 'semibold' : 'normal' })}>
                {option.isCorrect ? '✅ ' : '❌ '}{option.optionText}
              </span>
              <Show when={option.explanation}>
                {(exp) => (
                  <p class={css({ fontSize: 'sm', color: 'fg.muted', mt: '1' })}>{exp()}</p>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={props.note.explanation}>
        {(exp) => (
          <p class={css({ mt: '3', fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>
            {exp()}
          </p>
        )}
      </Show>
    </div>
  )
}

function ErrorNote(props: { note: DraftNote }) {
  return (
    <div>
      <div class={css({
        p: '3',
        mb: '3',
        borderRadius: 'l2',
        bg: 'red.2',
        border: '1px solid',
        borderColor: 'red.6',
      })}>
        <p class={css({ fontSize: 'xs', fontWeight: 'semibold', color: 'red.10', mb: '1', textTransform: 'uppercase', letterSpacing: 'wider' })}>
          Erroneous:
        </p>
        <p class={css({ fontSize: 'lg', color: 'red.11' })}>
          {props.note.front ?? '—'}
        </p>
      </div>

      <div class={css({
        p: '3',
        borderRadius: 'l2',
        bg: 'green.2',
        border: '1px solid',
        borderColor: 'green.6',
      })}>
        <p class={css({ fontSize: 'xs', fontWeight: 'semibold', color: 'green.10', mb: '1', textTransform: 'uppercase', letterSpacing: 'wider' })}>
          Correction:
        </p>
        <p class={css({ fontSize: 'lg', color: 'green.11' })}>
          {props.note.back ?? '—'}
        </p>
      </div>

      <Show when={props.note.explanation}>
        {(exp) => (
          <p class={css({ mt: '3', fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>
            {exp()}
          </p>
        )}
      </Show>
    </div>
  )
}

function ClassifierNote(props: { note: DraftNote; conceptName?: string | undefined }) {
  const options = () => props.note.options ?? []

  return (
    <div>
      <Show when={props.note.sentenceText}>
        {(text) => (
          <p class={css({ fontSize: 'lg', fontStyle: 'italic', mb: '4' })}>
            "{text()}"
          </p>
        )}
      </Show>

      <Show
        when={options().length > 0}
        fallback={
          <Show when={props.note.conceptId}>
            {(id) => (
              <p class={css({ fontSize: 'sm', color: 'fg.muted' })}>
                Correct concept: <span>{props.conceptName ?? id()}</span>
              </p>
            )}
          </Show>
        }
      >
        <div class={css({ display: 'flex', flexWrap: 'wrap', gap: '2' })}>
          <For each={options()}>
            {(option) => (
              <div class={css({
                display: 'inline-block',
                px: '3',
                py: '2',
                borderRadius: 'l2',
                border: '1px solid',
                borderColor: option.isCorrect ? 'green.7' : 'border',
                bg: option.isCorrect ? 'green.2' : 'bg.subtle',
                fontWeight: option.isCorrect ? 'semibold' : 'normal',
              })}>
                {option.isCorrect ? '✅ ' : '❌ '}{option.optionText}
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.note.explanation}>
        {(exp) => (
          <p class={css({ mt: '3', fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>
            {exp()}
          </p>
        )}
      </Show>
    </div>
  )
}

function renderNote(note: DraftNote, conceptName?: string) {
  switch (note.kind) {
    case 'cloze':      return <ClozeNote note={note} />
    case 'choice':     return <ChoiceNote note={note} />
    case 'error':      return <ErrorNote note={note} />
    case 'classifier': return <ClassifierNote note={note} conceptName={conceptName} />
    default:
      return (
        <pre class={css({ fontSize: 'xs', fontFamily: 'mono', whiteSpace: 'pre-wrap', color: 'fg.muted' })}>
          {JSON.stringify(note, null, 2)}
        </pre>
      )
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ReviewQueue() {
  const [notes, setNotes] = createSignal<DraftNote[]>([])
  const [total, setTotal] = createSignal(0)
  const [index, setIndex] = createSignal(0)
  const [loading, setLoading] = createSignal(true)
  const [phase, setPhase] = createSignal<ReviewPhase>('reviewing')
  const [pendingAction, setPendingAction] = createSignal<'flag' | 'reject' | null>(null)
  const [reason, setReason] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)

  const currentNote = createMemo(() => notes()[index()])
  const reviewedCount = createMemo(() => index())

  // Fetch grammar concept name for classifier notes (fires lazily, re-fetches as user advances)
  const [currentConcept] = createResource(
    () => {
      const note = currentNote()
      return note?.kind === 'classifier' && note?.conceptId ? note.conceptId : null
    },
    (conceptId) => api.grammarConcepts.get({ id: conceptId })
  )

  // Track whether any notes were loaded (for done state messaging)
  let initialCount = 0

  // Ref for reason input autofocus
  let reasonInputRef: HTMLInputElement | undefined

  onMount(async () => {
    try {
      const [draftRes, flaggedRes] = await Promise.allSettled([
        api.notes.listDrafts({ status: 'draft', limit: 50 }),
        api.notes.listDrafts({ status: 'flagged', limit: 50 }),
      ])
      const draftResult = draftRes.status === 'fulfilled' ? draftRes.value : { notes: [], total: 0 }
      const flaggedResult = flaggedRes.status === 'fulfilled' ? flaggedRes.value : { notes: [], total: 0 }
      // Drafts first, then flagged — so reviewers see fresh unreviewed content before re-reviews
      const merged = [
        ...(draftResult.notes as DraftNote[]),
        ...(flaggedResult.notes as DraftNote[]),
      ]
      setNotes(merged)
      setTotal(draftResult.total + flaggedResult.total)
      initialCount = merged.length
      setPhase(merged.length === 0 ? 'done' : 'reviewing')
    } catch (e) {
      setError(String(e))
      setPhase('error')
    } finally {
      setLoading(false)
    }
  })

  // Focus reason input when reasoning phase starts
  createEffect(() => {
    if (phase() === 'reasoning') {
      setTimeout(() => reasonInputRef?.focus(), 0)
    }
  })

  const advance = () => {
    const next = index() + 1
    if (next >= notes().length) {
      setPhase('done')
    } else {
      setIndex(next)
      setReason('')
      setPendingAction(null)
      setPhase('reviewing')
    }
  }

  const doAction = async (action: 'approve' | 'flag' | 'reject', reasonText?: string) => {
    const note = currentNote()
    if (!note || phase() === 'submitting') return
    setPhase('submitting')
    try {
      await api.notes.review({
        noteId: note.id,
        action,
        ...(reasonText ? { reason: reasonText } : {}),
      })
      advance()
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }

  const handleApprove = () => doAction('approve')

  const handleFlagOrReject = (action: 'flag' | 'reject') => {
    if (reason().trim()) {
      doAction(action, reason().trim())
    } else {
      setPendingAction(action)
      setPhase('reasoning')
    }
  }

  const confirmReason = () => {
    const action = pendingAction()
    if (!action) return
    doAction(action, reason().trim() || undefined)
  }

  const cancelReason = () => {
    setPendingAction(null)
    setReason('')
    setPhase('reviewing')
  }

  const handleSkip = () => advance()

  // Keyboard shortcuts
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const p = phase()
      if (p === 'reviewing') {
        if (e.key === 'a' || e.key === 'A') { e.preventDefault(); handleApprove() }
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); handleFlagOrReject('flag') }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); handleFlagOrReject('reject') }
        if (e.key === 'ArrowRight') { e.preventDefault(); handleSkip() }
      }
      if (p === 'reasoning') {
        if (e.key === 'Escape') { e.preventDefault(); cancelReason() }
      }
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })

  // Progress percentage
  const progressPct = createMemo(() => {
    const n = notes().length
    if (n === 0) return 100
    return Math.round((index() / n) * 100)
  })

  return (
    <div class={css({ py: '4', maxW: '640px', mx: 'auto' })}>
      {/* Progress bar */}
      <Show when={!loading() && phase() !== 'error'}>
        <div class={css({
          w: 'full',
          h: '2',
          bg: 'bg.subtle',
          borderRadius: 'full',
          mb: '6',
          overflow: 'hidden',
        })}>
          <div
            class={css({
              h: 'full',
              bg: 'accent.9',
              borderRadius: 'full',
              transition: 'width 0.3s ease',
            })}
            style={{ width: `${progressPct()}%` }}
          />
        </div>
      </Show>

      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '2', color: 'fg.default' })}>
        Review Queue
      </h1>

      <Show when={!loading() && notes().length > 0 && phase() !== 'done' && phase() !== 'error'}>
        <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '6' })}>
          {index() + 1} of {notes().length} · {notes().length - index() - 1} remaining
        </p>
      </Show>

      <Switch>
        {/* Loading */}
        <Match when={loading()}>
          <div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}>
            <Spinner size="lg" />
          </div>
        </Match>

        {/* Error */}
        <Match when={phase() === 'error'}>
          <ErrorState
            message={error() ?? 'Failed to load review queue'}
            onRetry={() => window.location.reload()}
          />
        </Match>

        {/* Done */}
        <Match when={phase() === 'done'}>
          <Card>
            <Show
              when={initialCount > 0}
              fallback={
                <div class={css({ textAlign: 'center', py: '8' })}>
                  <p class={css({ fontSize: '3xl', mb: '3' })}>✨</p>
                  <p class={css({ fontSize: 'xl', fontWeight: 'semibold', mb: '2', color: 'fg.default' })}>
                    All caught up!
                  </p>
                  <p class={css({ color: 'fg.muted', mb: '6' })}>
                    No exercises pending review.
                  </p>
                  <A href="/" class={css({ textDecoration: 'none' })}>
                    <Button variant="outline">Back to dashboard</Button>
                  </A>
                </div>
              }
            >
              <div class={css({ textAlign: 'center', py: '8' })}>
                <p class={css({ fontSize: '3xl', mb: '3' })}>🎉</p>
                <p class={css({ fontSize: 'xl', fontWeight: 'semibold', mb: '2', color: 'fg.default' })}>
                  Session complete!
                </p>
                <p class={css({ color: 'fg.muted', mb: '6' })}>
                  Reviewed {reviewedCount()} exercise{reviewedCount() === 1 ? '' : 's'}.
                </p>
                <A href="/" class={css({ textDecoration: 'none' })}>
                  <Button variant="outline">Back to dashboard</Button>
                </A>
              </div>
            </Show>
          </Card>
        </Match>

        {/* Active review */}
        <Match when={!loading() && phase() !== 'done' && phase() !== 'error'}>
          <Show when={currentNote()}>
            {(note) => (
              <Card>
                {/* Card header row: kind badge + flagged badge + optional concept ID */}
                <div class={css({
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: '4',
                })}>
                  <div class={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
                    <KindBadge kind={note().kind} />
                    <Show when={note().status === 'flagged'}>
                      <FlaggedBadge />
                    </Show>
                  </div>
                  <Show when={note().conceptId}>
                    {(id) => (
                      <span class={css({ fontSize: 'xs', color: 'fg.subtle', fontFamily: 'mono' })}>
                        {id()}
                      </span>
                    )}
                  </Show>
                </div>

                {/* Note content */}
                <div class={css({ mb: '6' })}>
                  {renderNote(note(), currentConcept()?.name)}
                </div>

                {/* Action row */}
                <Switch>
                  <Match when={phase() === 'reviewing'}>
                    <div class={css({ display: 'flex', gap: '2', flexWrap: 'wrap', alignItems: 'center' })}>
                      <Button variant="solid" onClick={handleApprove}>
                        ✅ Approve <kbd class={css({ fontSize: 'xs', opacity: '0.7', ml: '1' })}>A</kbd>
                      </Button>
                      <Button variant="outline" onClick={() => handleFlagOrReject('flag')}>
                        🚩 Flag <kbd class={css({ fontSize: 'xs', opacity: '0.7', ml: '1' })}>F</kbd>
                      </Button>
                      <Button variant="danger" onClick={() => handleFlagOrReject('reject')}>
                        ❌ Reject <kbd class={css({ fontSize: 'xs', opacity: '0.7', ml: '1' })}>R</kbd>
                      </Button>
                      <button
                        onClick={handleSkip}
                        class={css({
                          px: '3',
                          py: '2',
                          borderRadius: 'l2',
                          border: '1px solid',
                          borderColor: 'border',
                          bg: 'transparent',
                          color: 'fg.muted',
                          cursor: 'pointer',
                          fontSize: 'sm',
                          _hover: { color: 'fg.default', borderColor: 'fg.muted' },
                        })}
                      >
                        Skip →
                      </button>
                    </div>
                    <p class={css({ fontSize: 'xs', color: 'fg.subtle', mt: '3' })}>
                      Keyboard: A = approve · F = flag · R = reject · → = skip
                    </p>
                  </Match>

                  <Match when={phase() === 'reasoning'}>
                    <div class={css({
                      p: '4',
                      borderRadius: 'l2',
                      bg: 'bg.subtle',
                      border: '1px solid',
                      borderColor: 'border',
                    })}>
                      <p class={css({ fontSize: 'sm', fontWeight: 'medium', mb: '3', color: 'fg.default' })}>
                        Reason for {pendingAction()}:
                      </p>
                      <input
                        ref={(el) => { reasonInputRef = el }}
                        type="text"
                        value={reason()}
                        onInput={(e) => setReason(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); confirmReason() }
                        }}
                        placeholder="Optional reason…"
                        class={css({
                          display: 'block',
                          w: 'full',
                          px: '3',
                          py: '2',
                          mb: '3',
                          fontSize: 'sm',
                          borderRadius: 'l2',
                          border: '1px solid',
                          borderColor: 'border',
                          bg: 'bg',
                          color: 'fg.default',
                          outline: 'none',
                          _focus: { borderColor: 'accent.9', boxShadow: '0 0 0 1px {colors.accent.9}' },
                        })}
                      />
                      <div class={css({ display: 'flex', gap: '2' })}>
                        <Button variant="solid" onClick={confirmReason}>
                          Confirm
                        </Button>
                        <Button variant="ghost" onClick={cancelReason}>
                          Cancel (Esc)
                        </Button>
                      </div>
                    </div>
                  </Match>

                  <Match when={phase() === 'submitting'}>
                    <div class={css({ display: 'flex', alignItems: 'center', gap: '3', color: 'fg.muted' })}>
                      <Spinner size="sm" />
                      <span class={css({ fontSize: 'sm' })}>Saving…</span>
                    </div>
                  </Match>
                </Switch>
              </Card>
            )}
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
