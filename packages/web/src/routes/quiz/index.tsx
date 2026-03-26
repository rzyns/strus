import {
  createSignal, createMemo, createEffect, createResource,
  Show, Switch, Match, For, onMount, batch,
} from 'solid-js'
import { A, useSearchParams } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Spinner } from '../../components/Spinner'
import { ErrorState } from '../../components/ErrorState'
import { StateBadge } from '../../components/FsrsStateBadge'
import { formatTag } from '../../utils/tag-label'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DueCard {
  id: string
  kind: string
  tag: string | null
  state: number
  lemmaText: string | null
  front: string | null
  back: string | null
  forms: string[]
  formId: string | null
  lemmaFormId: string | null
  lemmaId: string | null
  audioUrl: string | null
  imageUrl: string | null
  imagePrompt: string | null
  lemmaAudioUrl: string | null
  noteId: string
  due: string
  // New fields for contextual exercise card kinds:
  sentenceText: string | null
  clozeGaps: Array<{
    gapIndex: number
    hint: string | null
    correctAnswers: string[]
    explanation: string | null
  }> | null
  choiceOptions: Array<{
    id: string
    optionText: string
    isCorrect: boolean
    explanation: string | null
  }> | null
  classifyOptions: Array<{
    id: string
    name: string
    isCorrect: boolean
    description: string | null
  }> | null
  noteExplanation: string | null
  stability: number
  difficulty: number
  reps: number
  lapses: number
  lastReview: string | null
  nextDates: { again: string; hard: string; good: string; easy: string }
}

function formatNextDate(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  const days = Math.round(diff / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'today'
  if (days < 30) return `${days}d`
  return `${Math.round(days / 30)}mo`
}

type QuizType = 'all' | 'morph' | 'gloss' | 'basic' | 'contextual'
type GlossDirection = 'both' | 'to-english' | 'to-polish'

type Phase =
  | 'config'
  | 'loading'
  | 'asking'
  | 'revealed-correct'
  | 'revealed-wrong'
  | 'revealed-manual'
  | 'done'
  | 'error'

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const labelStyle = css({
  display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default',
})
const selectStyle = css({
  px: '3', py: '2', fontSize: 'sm', borderRadius: 'l2',
  border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg.default', w: 'full',
})
const inputStyle = css({
  display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
  borderRadius: 'l2', border: '1px solid', borderColor: 'border',
  bg: 'bg', color: 'fg.default', outline: 'none',
  _focus: { borderColor: 'blue.8', boxShadow: '0 0 0 1px {colors.blue.8}' },
})

// ---------------------------------------------------------------------------
// Session info bar
// ---------------------------------------------------------------------------

interface SessionInfoProps {
  total: number
  reviewed: number
  correct: number
  streak: number
  lastResult: 'correct' | 'incorrect' | null
}

function SessionInfo(props: SessionInfoProps) {
  return (
    <div class={css({
      display: 'flex',
      alignItems: 'center',
      gap: '6',
      py: '3',
      px: '4',
      bg: 'bg',
      border: '1px solid',
      borderColor: 'border',
      borderRadius: 'l3',
      mb: '6',
      fontSize: 'sm',
      color: 'fg.muted',
      flexWrap: 'wrap',
    })}>
      <span>
        <span class={css({ fontWeight: 'semibold', color: 'fg.default' })}>{props.reviewed}</span>
        /{props.total} reviewed
      </span>
      <span>
        <span class={css({ fontWeight: 'semibold', color: 'fg.default' })}>{props.total - props.reviewed}</span>
        {' '}remaining
      </span>
      <span>
        Streak:{' '}
        <span class={css({ fontWeight: 'semibold', color: props.streak > 0 ? 'green.9' : 'fg.default' })}>
          {props.streak}
        </span>
      </span>
      <Show when={props.lastResult !== null}>
        <span class={css({
          fontWeight: 'semibold',
          color: props.lastResult === 'correct' ? 'green.9' : 'red.9',
        })}>
          Last: {props.lastResult === 'correct' ? '✓ correct' : '✗ incorrect'}
        </span>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rating buttons
// ---------------------------------------------------------------------------

interface RatingOption {
  label: string
  desc: string
  rating: 1 | 2 | 3 | 4
  variant?: 'solid' | 'outline' | 'danger'
  /** If true, this button receives focus when the set mounts */
  defaultFocus?: boolean
}

interface RatingButtonsProps {
  options: RatingOption[]
  onRate: (rating: 1 | 2 | 3 | 4) => void
  disabled: boolean
}

function RatingButtons(props: RatingButtonsProps) {
  // We hold a ref to the button that should receive default focus.
  let defaultRef: HTMLButtonElement | undefined

  // Focus the default button whenever this component's disabled state flips to false
  // (i.e. right after it mounts or after submitting is cleared).
  createEffect(() => {
    if (!props.disabled) {
      setTimeout(() => defaultRef?.focus(), 0)
    }
  })

  return (
    <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap', mt: '4' })}>
      <For each={props.options}>
        {(opt) => (
          <button
            ref={(el) => { if (opt.defaultFocus) defaultRef = el }}
            disabled={props.disabled}
            onClick={() => props.onRate(opt.rating)}
            class={css({
              display: 'flex',
              flexDir: 'column',
              alignItems: 'center',
              px: '4',
              py: '2',
              borderRadius: 'l2',
              border: '1px solid',
              cursor: 'pointer',
              transition: 'all 0.15s',
              minW: '80px',
              _disabled: { opacity: '0.5', cursor: 'not-allowed' },
              ...(opt.variant === 'danger'
                ? { bg: 'red.9', borderColor: 'red.9', color: 'white', _hover: { bg: 'red.10' } }
                : opt.variant === 'solid'
                ? { bg: 'accent.9', borderColor: 'accent.9', color: 'white', _hover: { bg: 'accent.10' } }
                : { bg: 'bg', borderColor: 'border', color: 'fg.default', _hover: { borderColor: 'fg.muted', bg: 'bg.subtle' } }
              ),
            })}
          >
            <span class={css({ fontWeight: 'semibold', fontSize: 'sm' })}>{opt.label}</span>
            <span class={css({ fontSize: 'xs', color: opt.variant ? 'inherit' : 'fg.muted', opacity: '0.85' })}>
              {opt.desc}
            </span>
          </button>
        )}
      </For>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generate button (for missing audio/image)
// ---------------------------------------------------------------------------

function GenerateButton(props: { label: string; onGenerate: () => Promise<void> }) {
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  return (
    <div>
      <button
        disabled={loading()}
        onClick={async () => {
          setLoading(true)
          setError(null)
          try { await props.onGenerate() }
          catch (e) { setError(e instanceof Error ? e.message : "Failed") }
          finally { setLoading(false) }
        }}
        class={css({
          fontSize: "xs", px: "3", py: "1.5", borderRadius: "l2",
          border: "1px dashed", borderColor: "border",
          bg: "transparent", cursor: "pointer", color: "fg.muted",
          _hover: { color: "fg.default", borderColor: "fg.muted" },
          _disabled: { opacity: 0.5, cursor: "not-allowed" },
        })}
      >
        {loading() ? "Generating\u2026" : props.label}
      </button>
      <Show when={error()}>
        {(err) => (
          <p class={css({ fontSize: 'xs', color: 'red.9', mt: '1' })}>{err()}</p>
        )}
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helper: resolve kinds[] from quiz type + direction
// ---------------------------------------------------------------------------

function resolveKinds(
  quizType: QuizType,
  direction: GlossDirection,
): string[] | undefined {
  switch (quizType) {
    case 'morph': return ['morph_form']
    case 'gloss':
      if (direction === 'to-english') return ['gloss_forward']
      if (direction === 'to-polish') return ['gloss_reverse']
      return ['gloss_forward', 'gloss_reverse']
    case 'basic': return ['basic_forward']
    case 'contextual': return ['cloze_fill', 'multiple_choice', 'classify', 'error_correction']
    default: return undefined // 'all'
  }
}

// ---------------------------------------------------------------------------
// ClozeInput component
// ---------------------------------------------------------------------------

interface ClozeInputProps {
  sentenceText: string
  gaps: Array<{ gapIndex: number; hint: string | null; correctAnswers: string[]; explanation: string | null }>
  answers: Record<number, string>
  onAnswer: (gapIndex: number, value: string) => void
  onEnter?: () => void
}

function ClozeInput(props: ClozeInputProps) {
  const parts = () => {
    const result: Array<{ type: 'text'; text: string } | { type: 'gap'; index: number }> = []
    const regex = /\{\{(\d+)\}\}/g
    let last = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(props.sentenceText)) !== null) {
      if (match.index > last) result.push({ type: 'text', text: props.sentenceText.slice(last, match.index) })
      result.push({ type: 'gap', index: parseInt(match[1]!) })
      last = regex.lastIndex
    }
    if (last < props.sentenceText.length) result.push({ type: 'text', text: props.sentenceText.slice(last) })
    return result
  }

  return (
    <p class={css({ fontSize: 'lg', lineHeight: '2.5' })}>
      <For each={parts()}>
        {(part) => (
          <>
            {part.type === 'text' ? (
              <span>{part.text}</span>
            ) : (() => {
              const gap = props.gaps.find(g => g.gapIndex === part.index)
              return (
                <span class={css({ display: 'inline-flex', flexDir: 'column', alignItems: 'center', mx: '1', verticalAlign: 'bottom' })}>
                  <input
                    type="text"
                    value={props.answers[part.index] ?? ''}
                    onInput={e => props.onAnswer(part.index, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const allFilled = props.gaps.every(g => (props.answers[g.gapIndex] ?? '').trim() !== '')
                        if (allFilled) props.onEnter?.()
                      }
                    }}
                    placeholder="…"
                    class={css({
                      display: 'inline-block', w: '32', px: '2', py: '1',
                      borderBottom: '2px solid', borderColor: 'blue.8', bg: 'transparent',
                      fontSize: 'inherit', outline: 'none', textAlign: 'center',
                    })}
                  />
                  <Show when={gap?.hint}>
                    {(hint) => (
                      <span class={css({ fontSize: 'xs', color: 'fg.muted', mt: '0.5' })}>{hint()}</span>
                    )}
                  </Show>
                </span>
              )
            })()}
          </>
        )}
      </For>
    </p>
  )
}

// ---------------------------------------------------------------------------
// highlightSie — wrap occurrences of "się" in a highlighted <strong>
// ---------------------------------------------------------------------------

function highlightSie(text: string): Array<{ text: string; highlight: boolean }> {
  const parts: Array<{ text: string; highlight: boolean }> = []
  const regex = /\bsię(?!\w)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), highlight: false })
    parts.push({ text: match[0], highlight: true })
    last = regex.lastIndex
  }
  if (last < text.length) parts.push({ text: text.slice(last), highlight: false })
  return parts
}

// ---------------------------------------------------------------------------
// RevealedContextualContent — shared between revealed-correct and revealed-wrong
// ---------------------------------------------------------------------------

function RevealedContextualContent(props: {
  card: DueCard
  clozeAnswers: Record<number, string>
  selectedOptionId: string | null
}) {
  return (
    <>
      {/* cloze_fill — per-gap breakdown */}
      <Show when={props.card.kind === 'cloze_fill'}>
        <For each={props.card.clozeGaps ?? []}>
          {(gap) => {
            const userAns = props.clozeAnswers[gap.gapIndex] ?? ''
            const ok = gap.correctAnswers.some(a => a.toLowerCase() === userAns.toLowerCase())
            return (
              <div class={css({ mb: '2' })}>
                <span class={css({ color: ok ? 'green.11' : 'red.11' })}>
                  {ok ? '✓' : '✗'} Gap {gap.gapIndex}:
                </span>
                {' '}<strong>{gap.correctAnswers[0]}</strong>
                <Show when={!ok && userAns !== ''}>
                  <span class={css({ color: 'fg.muted' })}> (you wrote: {userAns})</span>
                </Show>
                <Show when={gap.explanation}>
                  {(exp) => <p class={css({ fontSize: 'sm', color: 'fg.muted', mt: '1' })}>{exp()}</p>}
                </Show>
              </div>
            )
          }}
        </For>
        <Show when={props.card.noteExplanation}>
          {(exp) => <p class={css({ mt: '3', fontSize: 'sm', fontStyle: 'italic' })}>{exp()}</p>}
        </Show>
      </Show>

      {/* multiple_choice — option review */}
      <Show when={props.card.kind === 'multiple_choice'}>
        <For each={props.card.choiceOptions ?? []}>
          {(option) => (
            <div class={css({
              p: '2', mb: '2', borderRadius: 'l2',
              bg: option.isCorrect ? 'green.2' : props.selectedOptionId === option.id ? 'red.2' : 'transparent',
              border: '1px solid',
              borderColor: option.isCorrect ? 'green.8' : props.selectedOptionId === option.id ? 'red.8' : 'border',
            })}>
              <span class={css({ fontWeight: option.isCorrect ? 'bold' : 'normal' })}>
                {option.isCorrect ? '✓' : props.selectedOptionId === option.id ? '✗' : '·'} {option.optionText}
              </span>
              <Show when={option.explanation}>
                {(exp) => <p class={css({ fontSize: 'sm', color: 'fg.muted', mt: '1' })}>{exp()}</p>}
              </Show>
            </div>
          )}
        </For>
      </Show>

      {/* classify — concept button review */}
      <Show when={props.card.kind === 'classify'}>
        <div class={css({ mb: '2' })}>
          <For each={props.card.classifyOptions ?? []}>
            {(option) => (
              <div class={css({
                display: 'inline-block', m: '1', px: '3', py: '2', borderRadius: 'l2',
                bg: option.isCorrect ? 'green.2' : props.selectedOptionId === option.id ? 'red.2' : 'transparent',
                border: '1px solid',
                borderColor: option.isCorrect ? 'green.8' : props.selectedOptionId === option.id ? 'red.8' : 'border',
                fontWeight: option.isCorrect ? 'bold' : 'normal',
                verticalAlign: 'top',
              })}>
                <span class={css({ display: 'block' })}>
                  {option.isCorrect ? '✓ ' : props.selectedOptionId === option.id ? '✗ ' : ''}{option.name}
                </span>
                <Show when={option.description}>
                  {(desc) => <span class={css({ display: 'block', fontSize: 'xs', color: 'fg.muted', mt: '0.5', fontWeight: 'normal' })}>{desc()}</span>}
                </Show>
              </div>
            )}
          </For>
        </div>
        <Show when={props.card.noteExplanation}>
          {(exp) => <p class={css({ mt: '3', fontSize: 'sm', fontStyle: 'italic' })}>{exp()}</p>}
        </Show>
      </Show>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main quiz component
// ---------------------------------------------------------------------------

export default function Quiz() {
  // KC focused session params from URL
  const [searchParams] = useSearchParams()
  const focusedKcId = () => searchParams.kcId ?? null
  const focusedKcLabel = () => searchParams.kcLabel ?? null
  const focusedKcLabelPl = () => searchParams.kcLabelPl ?? null

  // Config form state
  const [quizType, setQuizType] = createSignal<QuizType>('all')
  const [direction, setDirection] = createSignal<GlossDirection>('both')
  const [tagFilter, setTagFilter] = createSignal('')
  const [listId, setListId] = createSignal('')
  const [mode, setMode] = createSignal<'card-first' | 'note-first'>('card-first')
  const [noteLimit, setNoteLimit] = createSignal(10)
  const [cardsPerNote, setCardsPerNote] = createSignal(5)
  const [limit, setLimit] = createSignal(100)

  // Fetch lists for the config form
  const [lists] = createResource(() => api.lists.list({}) as Promise<{ id: string; name: string }[]>)

  // Quiz state
  const [phase, setPhase] = createSignal<Phase>('config')
  const [cards, setCards] = createSignal<DueCard[]>([])
  const [index, setIndex] = createSignal(0)
  const [answer, setAnswer] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [submitting, setSubmitting] = createSignal(false)

  // For cloze_fill: map of gapIndex → user's typed answer
  const [clozeAnswers, setClozeAnswers] = createSignal<Record<number, string>>({})
  // For multiple_choice and classify: the id of the selected option
  const [selectedOptionId, setSelectedOptionId] = createSignal<string | null>(null)

  // Session stats
  const [reviewed, setReviewed] = createSignal(0)
  const [correct, setCorrect] = createSignal(0)
  const [streak, setStreak] = createSignal(0)
  const [lastResult, setLastResult] = createSignal<'correct' | 'incorrect' | null>(null)
  const [reviewedByKind, setReviewedByKind] = createSignal<Record<string, number>>({})

  const currentCard = createMemo(() => cards()[index()])
  const total = createMemo(() => cards().length)

  // Refs for focus management
  let inputRef: HTMLInputElement | undefined
  let nextBtnRef: HTMLButtonElement | undefined
  let audioRef: HTMLAudioElement | undefined

  // Local override signals for generated media (reset when card changes)
  const [localImageUrl, setLocalImageUrl] = createSignal<string | null>(null)
  const [localLemmaAudioUrl, setLocalLemmaAudioUrl] = createSignal<string | null>(null)
  const [localAudioUrl, setLocalAudioUrl] = createSignal<string | null>(null)

  createEffect(() => {
    // Reset local overrides when card changes
    const _id = currentCard()?.id
    setLocalImageUrl(null)
    setLocalLemmaAudioUrl(null)
    setLocalAudioUrl(null)
  })

  const effectiveImageUrl = () => localImageUrl() ?? currentCard()?.imageUrl ?? null
  const effectiveLemmaAudioUrl = () => localLemmaAudioUrl() ?? currentCard()?.lemmaAudioUrl ?? null
  const effectiveAudioUrl = () => localAudioUrl() ?? currentCard()?.audioUrl ?? null

  // Focus the right element whenever the phase changes.
  // createEffect runs after DOM updates, so refs are populated by the time this fires.
  createEffect(() => {
    const p = phase()
    if (p === "asking") setTimeout(() => inputRef?.focus(), 0)
    else if (p === "revealed-wrong") setTimeout(() => nextBtnRef?.focus(), 0)
    // 'revealed-correct' and 'revealed-manual' are handled inside RatingButtons
    // via their own createEffect (triggered when disabled flips false).
  })

  // Auto-play audio on phase transitions or when local audio signals update
  createEffect(() => {
    const p = phase()
    const card = currentCard()
    // Track local signals so effect re-runs when they change
    const lemmaAudio = effectiveLemmaAudioUrl()
    const formAudio = effectiveAudioUrl()
    if (!audioRef || !card) return

    let url: string | null = null
    if (p === 'asking') {
      if (card.kind === 'morph_form' || card.kind === 'gloss_forward') {
        url = lemmaAudio
      }
    } else if (p === 'revealed-correct' || p === 'revealed-wrong' || p === 'revealed-manual') {
      if (card.kind === 'morph_form') {
        url = formAudio
      } else if (card.kind === 'gloss_reverse') {
        url = lemmaAudio
      }
    }

    if (url) {
      audioRef.src = url
      audioRef.play().catch(() => {})
    }
  })

  const startQuiz = async () => {
    setAnswer('')
    setClozeAnswers({})
    setSelectedOptionId(null)
    setPhase('loading')
    try {
      const params: Record<string, unknown> = { limit: limit() }
      const kinds = resolveKinds(quizType(), direction())
      if (kinds) params.kinds = kinds
      const tag = tagFilter().trim()
      if (tag) params.tagContains = tag
      const list = listId()
      if (list) params.listId = list
      params.mode = mode()
      if (mode() === 'note-first') {
        params.noteLimit = noteLimit()
        params.cardsPerNote = cardsPerNote()
      }

      const kcId = focusedKcId()
      let due: DueCard[]
      if (kcId) {
        const targetedParams: Record<string, unknown> = { kcId, limit: limit() }
        if (kinds) targetedParams.kinds = kinds
        due = await api.session.targeted(targetedParams) as DueCard[]
      } else {
        due = await api.session.due(params) as DueCard[]
      }
      setCards(due)
      setPhase(due.length === 0 ? 'done' : 'asking')
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  }

  const checkAnswer = () => {
    const card = currentCard()
    if (!card) return

    switch (card.kind) {
      case 'basic_forward':
      case 'gloss_forward':
      case 'gloss_reverse':
        setPhase('revealed-manual')
        return
      case 'morph_form': {
        if (card.forms.length === 0) {
          // No expected forms available — fall back to manual reveal
          setPhase('revealed-manual')
          return
        }
        const userAnswer = answer().trim()
        const ok = card.forms.some(f => f.toLowerCase() === userAnswer.toLowerCase())
        setPhase(ok ? 'revealed-correct' : 'revealed-wrong')
        return
      }
      case 'cloze_fill': {
        const gaps = card.clozeGaps ?? []
        if (gaps.length === 0) { setPhase('revealed-manual'); return }
        const allCorrect = gaps.every(gap => {
          const userAns = (clozeAnswers()[gap.gapIndex] ?? '').trim()
          return gap.correctAnswers.some(a => a.toLowerCase() === userAns.toLowerCase())
        })
        setPhase(allCorrect ? 'revealed-correct' : 'revealed-wrong')
        return
      }
      case 'multiple_choice': {
        const selected = (card.choiceOptions ?? []).find(o => o.id === selectedOptionId())
        if (!selected) return
        setPhase(selected.isCorrect ? 'revealed-correct' : 'revealed-wrong')
        return
      }
      case 'classify': {
        const selected = (card.classifyOptions ?? []).find(o => o.id === selectedOptionId())
        if (!selected) return
        setPhase(selected.isCorrect ? 'revealed-correct' : 'revealed-wrong')
        return
      }
      case 'error_correction':
        setPhase('revealed-manual')
        return
      default:
        // Note: exhaustiveness check omitted because DueCard.kind is typed as
        // string (not a narrow union) in this component. Add new card kinds
        // above when implementing their quiz UI.
        setPhase('revealed-manual')
    }
  }

  const submitReview = async (rating: 1 | 2 | 3 | 4) => {
    const card = currentCard()
    if (!card || submitting()) return
    setSubmitting(true)

    try {
      await api.session.review({ cardId: card.id, rating })
    } catch (err) {
      console.error('Failed to record review:', err)
    }

    const wasCorrect = rating >= 2
    setReviewed(r => r + 1)
    setReviewedByKind(prev => ({ ...prev, [card.kind]: (prev[card.kind] ?? 0) + 1 }))
    if (wasCorrect) {
      setCorrect(c => c + 1)
      setStreak(s => s + 1)
      setLastResult('correct')
    } else {
      setStreak(0)
      setLastResult('incorrect')
    }

    const next = index() + 1
    if (next >= cards().length) {
      setPhase('done')
    } else {
      batch(() => {
        setIndex(next)
        setAnswer('')
        setClozeAnswers({})
        setSelectedOptionId(null)
        setPhase('asking')
      })
    }

    setSubmitting(false)
  }

  return (
    <div class={css({ py: '4', maxW: '640px', mx: 'auto' })}>
      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: focusedKcId() ? '2' : '6', color: 'fg.default' })}>
        Quiz
      </h1>

      <Show when={focusedKcId()}>
        <div class={css({
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2',
          px: '3',
          py: '1.5',
          mb: '4',
          bg: 'orange.2',
          border: '1px solid',
          borderColor: 'orange.6',
          borderRadius: 'l2',
          fontSize: 'sm',
        })}>
          <span class={css({ fontWeight: 'semibold', color: 'orange.11' })}>🎯 Focusing:</span>
          <span class={css({ color: 'orange.11' })}>
            {focusedKcLabelPl() ?? focusedKcLabel() ?? focusedKcId()}
            <Show when={focusedKcLabelPl() && focusedKcLabel()}>
              <span class={css({ ml: '1', color: 'orange.9', fontWeight: 'normal' })}>({focusedKcLabel()})</span>
            </Show>
          </span>
          <A href="/quiz" class={css({ ml: '2', fontSize: 'xs', color: 'orange.9', textDecoration: 'underline' })}>
            clear
          </A>
        </div>
      </Show>

      <Switch>
        {/* Config */}
        <Match when={phase() === 'config'}>
          <Card title="Quiz settings">
            <div class={css({ display: 'flex', flexDir: 'column', gap: '4' })}>
              {/* Quiz type */}
              <div>
                <label class={labelStyle}>Quiz type</label>
                <select
                  class={selectStyle}
                  value={quizType()}
                  onChange={(e) => setQuizType(e.currentTarget.value as QuizType)}
                >
                  <option value="all">All</option>
                  <option value="morph">Forms only</option>
                  <option value="gloss">Translations only</option>
                  <option value="basic">Basic cards</option>
                  <option value="contextual">Contextual / Advanced</option>
                </select>
              </div>

              {/* Tag filter — only for morph */}
              <Show when={quizType() === 'morph'}>
                <div>
                  <label class={labelStyle}>Tag filter</label>
                  <input
                    class={inputStyle}
                    type="text"
                    placeholder="e.g. sg:nom or inst"
                    value={tagFilter()}
                    onInput={(e) => setTagFilter(e.currentTarget.value)}
                  />
                  <p class={css({ fontSize: 'xs', color: 'fg.muted', mt: '1' })}>
                    Only show morph cards whose tag contains this substring
                  </p>
                </div>
              </Show>

              {/* Direction — only for gloss */}
              <Show when={quizType() === 'gloss'}>
                <div>
                  <label class={labelStyle}>Direction</label>
                  <select
                    class={selectStyle}
                    value={direction()}
                    onChange={(e) => setDirection(e.currentTarget.value as GlossDirection)}
                  >
                    <option value="both">Both</option>
                    <option value="to-english">Polish → English</option>
                    <option value="to-polish">English → Polish</option>
                  </select>
                </div>
              </Show>

              {/* List filter */}
              <div>
                <label class={labelStyle}>List</label>
                <select
                  class={selectStyle}
                  value={listId()}
                  onChange={(e) => setListId(e.currentTarget.value)}
                >
                  <option value="">All</option>
                  <Show when={lists()}>
                    {(data) => (
                      <For each={data()}>
                        {(list) => <option value={list.id}>{list.name}</option>}
                      </For>
                    )}
                  </Show>
                </select>
              </div>

              {/* Session strategy */}
              <div>
                <label class={labelStyle}>Session strategy</label>
                <select
                  class={selectStyle}
                  value={mode()}
                  onChange={(e) => setMode(e.currentTarget.value as 'card-first' | 'note-first')}
                >
                  <option value="card-first">Card-first (default)</option>
                  <option value="note-first">Note-first (word-based)</option>
                </select>
              </div>

              <Show when={mode() === 'note-first'}>
                <div>
                  <label class={labelStyle}>Notes to select</label>
                  <input
                    class={inputStyle}
                    type="number"
                    min="1"
                    max="100"
                    value={noteLimit()}
                    onInput={(e) => setNoteLimit(Number(e.currentTarget.value) || 10)}
                  />
                </div>
                <div>
                  <label class={labelStyle}>Cards per note</label>
                  <input
                    class={inputStyle}
                    type="number"
                    min="1"
                    max="20"
                    value={cardsPerNote()}
                    onInput={(e) => setCardsPerNote(Number(e.currentTarget.value) || 5)}
                  />
                </div>
                <p class={css({ fontSize: 'xs', color: 'fg.muted', mt: '-2' })}>
                  Selects words with the longest gap since last review, then picks cards within each word.
                </p>
              </Show>

              {/* Limit */}
              <div>
                <label class={labelStyle}>Limit</label>
                <input
                  class={inputStyle}
                  type="number"
                  min="1"
                  max="500"
                  value={limit()}
                  onInput={(e) => setLimit(Number(e.currentTarget.value) || 100)}
                />
              </div>

              <Button variant="solid" onClick={startQuiz}>
                Start Quiz
              </Button>
            </div>
          </Card>
        </Match>

        {/* Loading */}
        <Match when={phase() === 'loading'}>
          <div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}>
            <Spinner size="lg" />
          </div>
        </Match>

        {/* Error */}
        <Match when={phase() === 'error'}>
          <ErrorState
            message={error() ?? 'Failed to load quiz session'}
            onRetry={() => window.location.reload()}
          />
        </Match>

        {/* Done */}
        <Match when={phase() === 'done'}>
          <Show
            when={total() === 0}
            fallback={
              <Card title="Session complete">
                <div class={css({ textAlign: 'center', py: '4' })}>
                  <p class={css({ fontSize: '4xl', mb: '2' })}>🎉</p>
                  <p class={css({ fontSize: 'xl', fontWeight: 'semibold', color: 'fg.default', mb: '4' })}>
                    {correct()}/{reviewed()} correct
                  </p>
                  <p class={css({ color: 'fg.muted', mb: '2' })}>
                    {correct() === reviewed()
                      ? 'Perfect session!'
                      : `${Math.round((correct() / reviewed()) * 100)}% accuracy`}
                  </p>
                  {(() => {
                    const kindLabels: Record<string, string> = {
                      morph_form: 'morph forms',
                      gloss_forward: 'gloss (\u2192EN)',
                      gloss_reverse: 'gloss (\u2192PL)',
                      basic_forward: 'basic',
                    }
                    const byKind = reviewedByKind()
                    const entries = Object.entries(byKind).filter(([, v]) => v > 0)
                    if (entries.length <= 1) return null
                    return (
                      <p class={css({ color: 'fg.muted', fontSize: 'sm' })}>
                        {entries.map(([k, v]) => `${v} ${kindLabels[k] ?? k}`).join(' \u00B7 ')}
                      </p>
                    )
                  })()}
                  <div class={css({ mb: '4' })} />
                  <div class={css({ display: 'flex', gap: '3', justifyContent: 'center', flexWrap: 'wrap' })}>
                    <Button variant="solid" onClick={startQuiz}>
                      Again
                    </Button>
                    <Button variant="outline" onClick={() => { setCards([]); setPhase('config') }}>
                      Change settings
                    </Button>
                  </div>
                </div>
              </Card>
            }
          >
            <Card title="Nothing due">
              <p class={css({ color: 'fg.muted', mb: '4' })}>
                No cards are due right now. Come back later!
              </p>
              <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
                <Button variant="outline" onClick={startQuiz}>
                  Check again
                </Button>
                <Button variant="ghost" onClick={() => { setCards([]); setPhase('config') }}>
                  Change settings
                </Button>
              </div>
            </Card>
          </Show>
        </Match>

        {/* Active quiz */}
        <Match when={
          phase() === 'asking' ||
          phase() === 'revealed-correct' ||
          phase() === 'revealed-wrong' ||
          phase() === 'revealed-manual'
        }>
          <Show when={currentCard()}>
            {(card) => (
              <>
                <SessionInfo
                  total={total()}
                  reviewed={reviewed()}
                  correct={correct()}
                  streak={streak()}
                  lastResult={lastResult()}
                />

                <Card>
                  <div class={css({ fontSize: 'xs', color: 'fg.muted', mb: '4' })}>
                    Card {index() + 1} of {total()}
                  </div>

                  {/* FSRS state info strip */}
                  <div class={css({ display: 'flex', gap: '3', fontSize: 'xs', color: 'fg.muted', mb: '3', flexWrap: 'wrap', alignItems: 'center' })}>
                    <StateBadge state={card().state} />
                    <span>{card().reps} reps</span>
                    <span>{(() => {
                      const lr = card().lastReview
                      if (!lr) return 'never seen'
                      const diffMs = Date.now() - new Date(lr).getTime()
                      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
                      if (diffDays === 0) return 'today'
                      if (diffDays === 1) return 'yesterday'
                      return `${diffDays}d ago`
                    })()}</span>
                    {(() => {
                      const diffMs = new Date(card().due).getTime() - Date.now()
                      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
                      if (diffDays < 0) return (
                        <span class={css({ color: 'red.9' })}>{Math.abs(diffDays)}d overdue</span>
                      )
                      if (diffDays === 0) return <span>due today</span>
                      return null
                    })()}
                  </div>

                  {/* Prompt */}
                  <div class={css({ mb: '6' })}>
                    <Show when={card().kind !== 'basic_forward' && card().kind !== 'gloss_forward' && card().kind !== 'gloss_reverse'} fallback={
                      <>
                        <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                          {card().kind === 'basic_forward' ? 'Basic card' : card().kind === 'gloss_forward' ? 'Gloss — what does it mean?' : 'Gloss — what is the Polish word?'}
                        </p>
                        <p class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
                          {card().front}
                        </p>
                      </>
                    }>
                      <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                        {formatTag(card().tag ?? '')}
                      </p>
                      <p class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
                        {card().lemmaText}
                      </p>
                      <Show when={card().forms.length === 0}>
                        <p class={css({ fontSize: 'sm', color: 'fg.muted', mt: '1', fontStyle: 'italic' })}>
                          (manual entry — self-assess)
                        </p>
                      </Show>
                    </Show>
                  </div>

                  {/* Mnemonic image */}
                  <Show when={effectiveImageUrl()}>
                    {(url) => (
                      <img
                        src={url()}
                        alt="mnemonic"
                        class={css({
                          w: '100%', h: 'auto',
                          borderRadius: 'l2',
                          border: '1px solid', borderColor: 'border',
                          mb: '4', display: 'block',
                        })}
                      />
                    )}
                  </Show>
                  <Show when={card().lemmaId}>
                    <div class={css({ mb: '4' })}>
                      <GenerateButton
                        label={effectiveImageUrl() ? "Regenerate image" : "Generate image"}
                        onGenerate={async () => {
                          const result = await api.lemmas.generateImage({ id: card().lemmaId! }) as { imageUrl?: string | null }
                          if (result.imageUrl) setLocalImageUrl(result.imageUrl)
                        }}
                      />
                    </div>
                  </Show>
                  {/* Collapsible image generation prompt */}
                  <Show when={phase() === 'asking' && card().imagePrompt}>
                    {(prompt) => (
                      <details style={{ "margin-top": "0", "margin-bottom": "8px" }}>
                        <summary style={{ "font-size": "0.75rem", color: "var(--colors-fg-muted)", cursor: "pointer" }}>
                          Image generation prompt
                        </summary>
                        <textarea
                          readonly
                          value={prompt()}
                          rows={4}
                          style={{
                            "font-size": "0.7rem", "font-family": "monospace", width: "100%",
                            "margin-top": "4px", resize: "none", border: "1px solid var(--colors-border)",
                            "border-radius": "4px", padding: "6px", background: "var(--colors-bg-subtle)",
                            color: "var(--colors-fg-muted)",
                          }}
                        />
                      </details>
                    )}
                  </Show>

                  {/* Generate citation audio button (question side) */}
                  <Show when={!effectiveLemmaAudioUrl() && card().lemmaFormId}>
                    <div class={css({ mb: '4' })}>
                      <GenerateButton
                        label="Generate audio"
                        onGenerate={async () => {
                          const result = await api.forms.generateAudio({ id: card().lemmaFormId! })
                          if (result.audioUrl) setLocalLemmaAudioUrl(result.audioUrl)
                        }}
                      />
                    </div>
                  </Show>

                  {/* ── Asking ── */}
                  <Show when={phase() === 'asking'}>
                    <Switch>
                      <Match when={card().kind === 'basic_forward' || card().kind === 'gloss_forward' || card().kind === 'gloss_reverse'}>
                        <Button variant="solid" onClick={checkAnswer}>
                          Reveal
                        </Button>
                      </Match>
                      <Match when={card().kind === 'error_correction'}>
                        <p class={css({ fontSize: 'lg', color: 'red.11' })}>{card().front}</p>
                        <p class={css({ fontSize: 'sm', color: 'fg.muted', mt: '2' })}>
                          Can you spot and correct the error?
                        </p>
                        <div class={css({ mt: '4' })}>
                          <Button variant="solid" onClick={checkAnswer}>
                            Reveal correction
                          </Button>
                        </div>
                      </Match>
                      <Match when={card().kind === 'cloze_fill'}>
                        <Show when={card().lemmaText}>
                          {(lemma) => (
                            <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '2' })}>
                              Verb: <strong>{lemma()}</strong>
                            </p>
                          )}
                        </Show>
                        <ClozeInput
                          sentenceText={card().sentenceText ?? ''}
                          gaps={card().clozeGaps ?? []}
                          answers={clozeAnswers()}
                          onAnswer={(gapIndex, value) =>
                            setClozeAnswers(prev => ({ ...prev, [gapIndex]: value }))
                          }
                          onEnter={checkAnswer}
                        />
                        <div class={css({ mt: '4' })}>
                          <Button
                            variant="solid"
                            onClick={checkAnswer}
                            disabled={
                              submitting() ||
                              Object.values(clozeAnswers()).filter(v => v.trim() !== '').length === 0
                            }
                          >
                            Submit
                          </Button>
                        </div>
                      </Match>
                      <Match when={card().kind === 'multiple_choice'}>
                        <p class={css({ fontSize: 'lg', mb: '4' })}>{card().front}</p>
                        <For each={card().choiceOptions ?? []}>
                          {(option) => (
                            <button
                              onClick={() => setSelectedOptionId(option.id)}
                              class={css({
                                display: 'block', w: 'full', textAlign: 'left', p: '3', mb: '2',
                                borderRadius: 'l2', border: '2px solid',
                                borderColor: selectedOptionId() === option.id ? 'blue.8' : 'border',
                                bg: selectedOptionId() === option.id ? 'blue.2' : 'bg',
                                cursor: 'pointer',
                              })}
                            >
                              {option.optionText}
                            </button>
                          )}
                        </For>
                        <div
                          class={css({ mt: '2' })}
                          onKeyDown={(e) => { if (e.key === 'Enter' && selectedOptionId()) checkAnswer() }}
                        >
                          <Button
                            variant="solid"
                            onClick={checkAnswer}
                            disabled={submitting() || !selectedOptionId()}
                          >
                            Check
                          </Button>
                        </div>
                      </Match>
                      <Match when={card().kind === 'classify'}>
                        <Show when={card().lemmaText}>
                          {(lemma) => (
                            <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '2' })}>
                              Verb: <strong>{lemma()}</strong>
                            </p>
                          )}
                        </Show>
                        <Show when={card().sentenceText}>
                          {(text) => (
                            <p class={css({ fontSize: 'lg', mb: '4', fontStyle: 'italic' })}>
                              "
                              <For each={highlightSie(text())}>
                                {(part) => part.highlight
                                  ? <strong class={css({ bg: 'yellow.3', color: 'fg.default', borderRadius: 'sm', px: '1' })}>{part.text}</strong>
                                  : <span>{part.text}</span>
                                }
                              </For>
                              "
                            </p>
                          )}
                        </Show>
                        <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '3' })}>
                          What type of grammatical feature does the highlighted usage represent?
                        </p>
                        <For each={card().classifyOptions ?? []}>
                          {(option) => (
                            <button
                              onClick={() => setSelectedOptionId(option.id)}
                              class={css({
                                display: 'inline-block', m: '1', px: '3', py: '2',
                                borderRadius: 'l2', border: '2px solid',
                                borderColor: selectedOptionId() === option.id ? 'blue.8' : 'border',
                                bg: selectedOptionId() === option.id ? 'blue.2' : 'bg',
                                cursor: 'pointer', fontSize: 'sm',
                                verticalAlign: 'top',
                              })}
                            >
                              <span class={css({ display: 'block', fontWeight: 'medium' })}>{option.name}</span>
                              <Show when={option.description}>
                                {(desc) => <span class={css({ display: 'block', fontSize: 'xs', color: 'fg.muted', mt: '0.5' })}>{desc()}</span>}
                              </Show>
                            </button>
                          )}
                        </For>
                        <div
                          class={css({ mt: '4' })}
                          onKeyDown={(e) => { if (e.key === 'Enter' && selectedOptionId()) checkAnswer() }}
                        >
                          <Button
                            variant="solid"
                            onClick={checkAnswer}
                            disabled={submitting() || !selectedOptionId()}
                          >
                            Check
                          </Button>
                        </div>
                      </Match>
                      <Match when={true}>
                        {/* morph_form and any other kinds with text input */}
                        <div class={css({ display: 'flex', gap: '3', alignItems: 'stretch' })}>
                          <input
                            ref={(el) => { inputRef = el }}
                            type="text"
                            placeholder="Type the correct form…"
                            value={answer()}
                            onInput={(e) => setAnswer(e.currentTarget.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') checkAnswer() }}
                            class={css({
                              flex: '1',
                              px: '3',
                              py: '2',
                              borderRadius: 'l2',
                              border: '1px solid',
                              borderColor: 'border',
                              bg: 'bg',
                              color: 'fg.default',
                              fontSize: 'md',
                              outline: 'none',
                              _focus: { borderColor: 'accent.9', ring: '2px', ringColor: 'accent.a4' },
                              _placeholder: { color: 'fg.subtle' },
                            })}
                          />
                          <Button variant="solid" onClick={checkAnswer} disabled={answer().trim() === ''}>
                            Submit
                          </Button>
                        </div>
                      </Match>
                    </Switch>
                  </Show>

                  {/* ── Correct reveal ── */}
                  <Show when={phase() === 'revealed-correct'}>
                    <div class={css({
                      p: '4', borderRadius: 'l2', bg: 'green.2',
                      border: '1px solid', borderColor: 'green.6', mb: '2',
                    })}>
                      <p class={css({ color: 'green.11', fontWeight: 'semibold', mb: '1' })}>✓ Correct!</p>
                      <Show when={card().kind === 'morph_form'}>
                        <p class={css({ color: 'green.10', fontSize: 'sm' })}>
                          Your answer: <strong>{answer()}</strong>
                        </p>
                      </Show>
                    </div>
                    <RevealedContextualContent
                      card={card()}
                      clozeAnswers={clozeAnswers()}
                      selectedOptionId={selectedOptionId()}
                    />
                    <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '2', mt: '3' })}>
                      How easy was that recall?
                    </p>
                    <RatingButtons
                      options={[
                        { label: 'Hard', desc: formatNextDate(card().nextDates.hard), rating: 2 },
                        { label: 'Good', desc: formatNextDate(card().nextDates.good), rating: 3, variant: 'solid', defaultFocus: true },
                        { label: 'Easy', desc: formatNextDate(card().nextDates.easy), rating: 4 },
                      ]}
                      onRate={submitReview}
                      disabled={submitting()}
                    />
                  </Show>

                  {/* ── Wrong reveal ── */}
                  <Show when={phase() === 'revealed-wrong'}>
                    <div class={css({
                      p: '4', borderRadius: 'l2', bg: 'red.2',
                      border: '1px solid', borderColor: 'red.6', mb: '4',
                    })}>
                      <p class={css({ color: 'red.11', fontWeight: 'semibold', mb: '1' })}>✗ Incorrect</p>
                      <Show when={card().kind === 'morph_form'}>
                        <Show when={answer().trim() !== ''}>
                          <p class={css({ color: 'red.10', fontSize: 'sm', mb: '1' })}>
                            Your answer: <strong>{answer()}</strong>
                          </p>
                        </Show>
                        <p class={css({ color: 'fg.default', fontSize: 'sm' })}>
                          Correct form{card().forms.length > 1 ? 's' : ''}:{' '}
                          <strong>{card().forms.join(' / ')}</strong>
                        </p>
                      </Show>
                    </div>
                    <RevealedContextualContent
                      card={card()}
                      clozeAnswers={clozeAnswers()}
                      selectedOptionId={selectedOptionId()}
                    />
                    <p class={css({ fontSize: 'xs', color: 'fg.muted', mt: '2' })}>
                      Again → {formatNextDate(card().nextDates.again)}
                    </p>
                    <A
                      href={`/notes/${card().noteId}`}
                      class={css({
                        fontSize: 'xs', color: 'blue.9', display: 'inline-block', mt: '1',
                        _hover: { textDecoration: 'underline' }, textDecoration: 'none',
                      })}
                    >
                      View note →
                    </A>
                    <button
                      ref={(el) => { nextBtnRef = el }}
                      disabled={submitting()}
                      onClick={() => submitReview(1)}
                      class={css({
                        px: '4', py: '2', borderRadius: 'l2',
                        border: '1px solid', borderColor: 'border',
                        bg: 'bg', color: 'fg.default', cursor: 'pointer',
                        fontSize: 'sm', fontWeight: 'medium',
                        transition: 'all 0.15s',
                        _hover: { borderColor: 'fg.muted', bg: 'bg.subtle' },
                        _disabled: { opacity: '0.5', cursor: 'not-allowed' },
                        _focus: { outline: '2px solid', outlineColor: 'accent.9', outlineOffset: '2px' },
                      })}
                    >
                      {submitting() ? 'Saving…' : 'Next →'}
                    </button>
                  </Show>

                  {/* ── Manual reveal ── */}
                  <Show when={phase() === 'revealed-manual'}>
                    <div class={css({
                      p: '4', borderRadius: 'l2', bg: 'bg.subtle',
                      border: '1px solid', borderColor: 'border', mb: '2',
                    })}>
                      <Switch>
                        <Match when={card().kind === 'basic_forward' || card().kind === 'gloss_forward' || card().kind === 'gloss_reverse'}>
                          <p class={css({ fontSize: 'lg', fontWeight: 'semibold', color: 'fg.default' })}>
                            {card().back}
                          </p>
                        </Match>
                        <Match when={card().kind === 'error_correction'}>
                          <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>Correction:</p>
                          <p class={css({ fontSize: 'lg', color: 'green.11', fontWeight: 'medium' })}>
                            {card().back}
                          </p>
                          <Show when={card().noteExplanation}>
                            {(exp) => (
                              <p class={css({ mt: '2', fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>
                                {exp()}
                              </p>
                            )}
                          </Show>
                        </Match>
                        <Match when={true}>
                          <p class={css({ color: 'fg.muted', fontSize: 'sm' })}>
                            No forms on record — rate your recall honestly.
                          </p>
                        </Match>
                      </Switch>
                    </div>
                    <A
                      href={`/notes/${card().noteId}`}
                      class={css({
                        fontSize: 'xs', color: 'blue.9', display: 'inline-block', mt: '1',
                        _hover: { textDecoration: 'underline' }, textDecoration: 'none',
                      })}
                    >
                      View note →
                    </A>
                    <RatingButtons
                      options={[
                        { label: 'Again', desc: formatNextDate(card().nextDates.again), rating: 1, variant: 'danger' },
                        { label: 'Hard', desc: formatNextDate(card().nextDates.hard), rating: 2 },
                        { label: 'Good', desc: formatNextDate(card().nextDates.good), rating: 3, variant: 'solid', defaultFocus: true },
                        { label: 'Easy', desc: formatNextDate(card().nextDates.easy), rating: 4 },
                      ]}
                      onRate={submitReview}
                      disabled={submitting()}
                    />
                  </Show>

                  {/* Generate form audio button (answer side, morph_form only) */}
                  <Show when={
                    (phase() === 'revealed-correct' || phase() === 'revealed-wrong' || phase() === 'revealed-manual') &&
                    card().kind === 'morph_form' && !effectiveAudioUrl() && card().formId
                  }>
                    <div class={css({ mt: '3' })}>
                      <GenerateButton
                        label="Generate audio"
                        onGenerate={async () => {
                          const result = await api.forms.generateAudio({ id: card().formId! })
                          if (result.audioUrl) setLocalAudioUrl(result.audioUrl)
                        }}
                      />
                    </div>
                  </Show>

                  <audio ref={(el) => { audioRef = el }} style={{ display: "none" }} />
                </Card>
              </>
            )}
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
