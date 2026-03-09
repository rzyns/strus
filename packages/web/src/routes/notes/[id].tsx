import { createResource, createSignal, createMemo, For, Show, Switch, Match, Suspense, ErrorBoundary, type JSX } from 'solid-js'
import { useParams, useNavigate, A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import type { NoteDetail, CardItem, ReviewItem, MorphFormItem } from '../../api/types'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { StateBadge, formatDue } from '../../components/FsrsStateBadge'
import { formatTag } from '../../utils/tag-label'

// Rating label and color for review history
const ratingMeta: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'Again', color: 'red.11', bg: 'red.3' },
  2: { label: 'Hard', color: 'orange.11', bg: 'orange.3' },
  3: { label: 'Good', color: 'green.11', bg: 'green.3' },
  4: { label: 'Easy', color: 'teal.11', bg: 'teal.3' },
}

// ---------------------------------------------------------------------------
// Kind helpers
// ---------------------------------------------------------------------------

const CONTEXTUAL_KINDS = ['cloze', 'choice', 'error', 'classifier'] as const
type ContextualKind = typeof CONTEXTUAL_KINDS[number]

function isContextualKind(kind: string): kind is ContextualKind {
  return (CONTEXTUAL_KINDS as readonly string[]).includes(kind)
}

function kindTitle(kind: string): string {
  switch (kind) {
    case 'morph': return 'Morph Note'
    case 'basic': return 'Basic Note'
    case 'gloss': return 'Gloss Note'
    case 'cloze': return 'Cloze Exercise'
    case 'choice': return 'Multiple Choice Exercise'
    case 'error': return 'Error Correction Exercise'
    case 'classifier': return 'Classifier Exercise'
    default: return kind
  }
}

function kindBadgeColors(kind: string): { bg: string; color: string } {
  switch (kind) {
    case 'morph': return { bg: 'blue.3', color: 'blue.11' }
    case 'basic': return { bg: 'green.3', color: 'green.11' }
    case 'gloss': return { bg: 'purple.3', color: 'purple.11' }
    case 'cloze': return { bg: 'teal.3', color: 'teal.11' }
    case 'choice': return { bg: 'violet.3', color: 'violet.11' }
    case 'error': return { bg: 'red.3', color: 'red.11' }
    case 'classifier': return { bg: 'orange.3', color: 'orange.11' }
    default: return { bg: 'gray.3', color: 'gray.11' }
  }
}

function statusBadgeInfo(status: string | null): { bg: string; color: string; label: string } | null {
  switch (status) {
    case 'draft': return { bg: 'amber.3', color: 'amber.11', label: 'Draft — pending review' }
    case 'approved': return { bg: 'green.3', color: 'green.11', label: 'Approved' }
    case 'flagged': return { bg: 'orange.3', color: 'orange.11', label: 'Flagged' }
    case 'rejected': return { bg: 'red.3', color: 'red.11', label: 'Rejected' }
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Contextual note body renderers
// ---------------------------------------------------------------------------

type GapItem = { id: string; gapIndex: number; correctAnswers: string; hint: string | null; explanation: string | null }
type OptionItem = { id: string; optionText: string; isCorrect: boolean; explanation: string | null }

function ClozeBody(props: { sentenceText: string | null; gaps: GapItem[]; explanation: string | null }): JSX.Element {
  const gapAnswers = (): Record<number, string> => {
    const map: Record<number, string> = {}
    for (const g of props.gaps) {
      try {
        const answers = JSON.parse(g.correctAnswers) as string[]
        map[g.gapIndex] = answers[0] ?? '?'
      } catch {
        map[g.gapIndex] = g.correctAnswers
      }
    }
    return map
  }

  const parts = (): Array<{ type: 'text'; text: string } | { type: 'gap'; index: number }> => {
    const sentence = props.sentenceText ?? ''
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
    <div class={css({ mb: '6', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'l3', bg: 'bg.subtle' })}>
      <p class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.muted', mb: '2' })}>Sentence</p>
      <p class={css({ fontSize: 'lg', lineHeight: '2', mb: '4' })}>
        <For each={parts()}>
          {(part) => (
            <>
              {part.type === 'text' ? (
                <span>{part.text}</span>
              ) : (
                <span class={css({
                  display: 'inline-block',
                  px: '2', py: '0.5', mx: '0.5',
                  borderRadius: 'l2',
                  bg: 'green.3', color: 'green.11',
                  fontWeight: 'semibold', fontSize: 'sm',
                })}>
                  {gapAnswers()[part.index] ?? '?'}
                </span>
              )}
            </>
          )}
        </For>
      </p>

      <Show when={props.gaps.length > 0}>
        <div class={css({ mb: '3' })}>
          <p class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.muted', mb: '2' })}>Gaps</p>
          <For each={props.gaps}>
            {(gap) => (
              <div class={css({ fontSize: 'sm', color: 'fg.default', mb: '1', pl: '2', borderLeft: '2px solid', borderColor: 'green.6' })}>
                <span class={css({ fontWeight: 'medium' })}>Gap {gap.gapIndex}:</span>{' '}
                {gapAnswers()[gap.gapIndex] ?? '?'}
                <Show when={gap.hint}>
                  {(h) => <span class={css({ color: 'fg.muted' })}> · Hint: {h()}</span>}
                </Show>
                <Show when={gap.explanation}>
                  {(e) => <span class={css({ color: 'fg.muted' })}> — {e()}</span>}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.explanation}>
        {(exp) => (
          <p class={css({ fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>{exp()}</p>
        )}
      </Show>
    </div>
  )
}

function ChoiceBody(props: { sentenceText: string | null; front: string | null; options: OptionItem[]; explanation: string | null }): JSX.Element {
  return (
    <div class={css({ mb: '6', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'l3', bg: 'bg.subtle' })}>
      <Show when={props.sentenceText}>
        {(text) => (
          <p class={css({ fontSize: 'md', fontStyle: 'italic', color: 'fg.muted', mb: '3' })}>
            "{text()}"
          </p>
        )}
      </Show>
      <Show when={props.front}>
        {(prompt) => (
          <p class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '4' })}>{prompt()}</p>
        )}
      </Show>
      <div class={css({ display: 'flex', flexDir: 'column', gap: '2', mb: '3' })}>
        <For each={props.options}>
          {(option) => (
            <div class={css({
              p: '3', borderRadius: 'l2',
              border: '1px solid',
              borderColor: option.isCorrect ? 'green.7' : 'border',
              bg: option.isCorrect ? 'green.2' : 'bg',
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
      <Show when={props.explanation}>
        {(exp) => (
          <p class={css({ fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>{exp()}</p>
        )}
      </Show>
    </div>
  )
}

function ErrorBody(props: { front: string | null; back: string | null; explanation: string | null }): JSX.Element {
  return (
    <div class={css({ mb: '6' })}>
      <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap', mb: '3' })}>
        <div class={css({ flex: '1', minW: '180px', p: '3', borderRadius: 'l2', bg: 'red.2', border: '1px solid', borderColor: 'red.6' })}>
          <p class={css({ fontSize: 'xs', fontWeight: 'semibold', color: 'red.10', mb: '1', textTransform: 'uppercase', letterSpacing: 'wider' })}>
            Erroneous
          </p>
          <p class={css({ fontSize: 'lg', color: 'red.11' })}>{props.front ?? '—'}</p>
        </div>
        <div class={css({ flex: '1', minW: '180px', p: '3', borderRadius: 'l2', bg: 'green.2', border: '1px solid', borderColor: 'green.6' })}>
          <p class={css({ fontSize: 'xs', fontWeight: 'semibold', color: 'green.10', mb: '1', textTransform: 'uppercase', letterSpacing: 'wider' })}>
            Correction
          </p>
          <p class={css({ fontSize: 'lg', color: 'green.11' })}>{props.back ?? '—'}</p>
        </div>
      </div>
      <Show when={props.explanation}>
        {(exp) => (
          <p class={css({ fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>{exp()}</p>
        )}
      </Show>
    </div>
  )
}

function ClassifierBody(props: { sentenceText: string | null; conceptName: string | undefined; conceptLoading: boolean; explanation: string | null }): JSX.Element {
  return (
    <div class={css({ mb: '6', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'l3', bg: 'bg.subtle' })}>
      <Show when={props.sentenceText}>
        {(text) => (
          <p class={css({ fontSize: 'lg', fontStyle: 'italic', mb: '4' })}>"{text()}"</p>
        )}
      </Show>
      <p class={css({ fontSize: 'sm', color: 'fg.default', mb: '2' })}>
        <span class={css({ fontWeight: 'medium' })}>Correct category: </span>
        <Show
          when={!props.conceptLoading}
          fallback={<Spinner size="sm" />}
        >
          <span>{props.conceptName ?? '—'}</span>
        </Show>
      </p>
      <Show when={props.explanation}>
        {(exp) => (
          <p class={css({ fontSize: 'sm', fontStyle: 'italic', color: 'fg.muted' })}>{exp()}</p>
        )}
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Contextual card preview (for Preview tab)
// ---------------------------------------------------------------------------

function ContextualCardPreview(props: {
  kind: string
  sentenceText: string | null
  front: string | null
  back: string | null
  gaps: GapItem[] | undefined
  options: OptionItem[] | undefined
  explanation: string | null
  conceptName: string | undefined
  conceptLoading: boolean
}): JSX.Element {
  return (
    <div class={css({
      p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'l3', bg: 'bg',
    })}>
      <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '3' })}>
        {props.kind.replace('_', ' ')}
      </p>
      <Switch>
        <Match when={props.kind === 'cloze_fill'}>
          <ClozeBody
            sentenceText={props.sentenceText}
            gaps={props.gaps ?? []}
            explanation={props.explanation}
          />
        </Match>
        <Match when={props.kind === 'multiple_choice'}>
          <ChoiceBody
            sentenceText={props.sentenceText}
            front={props.front}
            options={props.options ?? []}
            explanation={props.explanation}
          />
        </Match>
        <Match when={props.kind === 'error_correction'}>
          <ErrorBody
            front={props.front}
            back={props.back}
            explanation={props.explanation}
          />
        </Match>
        <Match when={props.kind === 'classify'}>
          <ClassifierBody
            sentenceText={props.sentenceText}
            conceptName={props.conceptName}
            conceptLoading={props.conceptLoading}
            explanation={props.explanation}
          />
        </Match>
      </Switch>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quiz card preview — shows both sides of a card as it would appear in quiz
// ---------------------------------------------------------------------------

interface QuizCardPreviewProps {
  kind: string
  tag: string | null
  lemmaText: string | null
  front: string | null
  back: string | null
  forms: string[]
  audioUrl?: string | null
}

function QuizCardPreview(props: QuizCardPreviewProps): JSX.Element {
  const prompt = (): { label: string; text: string } => {
    switch (props.kind) {
      case 'morph_form':
        return { label: formatTag(props.tag ?? ''), text: props.lemmaText ?? '' }
      case 'gloss_forward':
        return { label: 'Gloss — what does it mean?', text: props.lemmaText ?? props.front ?? '' }
      case 'gloss_reverse':
        return { label: 'Gloss — what is the Polish word?', text: props.back ?? '' }
      case 'basic_forward':
        return { label: 'Basic card', text: props.front ?? '' }
      default:
        return { label: props.kind, text: props.front ?? '' }
    }
  }

  const answer = (): string => {
    switch (props.kind) {
      case 'morph_form':
        return props.forms.join(' / ') || '—'
      case 'gloss_forward':
        return props.back ?? '—'
      case 'gloss_reverse':
        return props.lemmaText ?? props.front ?? '—'
      case 'basic_forward':
        return props.back ?? '—'
      default:
        return props.back ?? '—'
    }
  }

  return (
    <div class={css({
      p: '4',
      border: '1px solid',
      borderColor: 'border',
      borderRadius: 'l3',
      bg: 'bg',
    })}>
      {/* Question side */}
      <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
        {prompt().label}
      </p>
      <p class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
        {prompt().text}
      </p>

      {/* Divider */}
      <div class={css({
        my: '3',
        borderTop: '1px dashed',
        borderColor: 'border',
      })} />

      {/* Answer side */}
      <p class={css({ fontSize: 'xs', fontWeight: 'medium', color: 'fg.subtle', mb: '1', textTransform: 'uppercase', letterSpacing: 'wide' })}>
        Answer
      </p>
      <p class={css({ fontSize: 'lg', fontWeight: 'semibold', color: 'fg.default' })}>
        {answer()}
      </p>
      <Show when={props.audioUrl}>
        {(url) => (
          <audio
            controls
            src={url()}
            class={css({ mt: '3', w: 'full', maxW: '320px', height: '32px' })}
          />
        )}
      </Show>
    </div>
  )
}

const CONTEXTUAL_CARD_KINDS = ['cloze_fill', 'multiple_choice', 'error_correction', 'classify'] as const

export default function NoteDetail() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [note, { refetch }] = createResource<NoteDetail>(() => api.notes.get({ id: params.id }))
  // Fetch morph forms so we can show the answer alongside each morph_form card
  // Source returns undefined when no lemmaId — SolidJS skips the fetcher in that case
  const [lemmaForms] = createResource<MorphFormItem[], string>(
    () => note()?.lemmaId ?? undefined,
    (lemmaId: string) => api.lemmas.forms({ id: lemmaId })
  )
  // Fetch the full lemma to get imageUrl
  const [lemma] = createResource(
    () => note()?.lemmaId ?? undefined,
    (lemmaId: string) => api.lemmas.get({ id: lemmaId })
  )

  // Fetch grammar concept name for contextual note kinds (cloze/choice/error/classifier)
  const [concept] = createResource(
    () => note()?.conceptId ?? undefined,
    (conceptId: string) => api.grammarConcepts.get({ id: conceptId })
  )

  // Cards / Preview tab state
  const [detailTab, setDetailTab] = createSignal<'cards' | 'preview'>('cards')

  // Review history expansion state
  const [expandedCards, setExpandedCards] = createSignal<Set<string>>(new Set())
  const [reviewCache, setReviewCache] = createSignal<Record<string, ReviewItem[]>>({})
  const [loadingReviews, setLoadingReviews] = createSignal<Set<string>>(new Set())

  // Triage state for contextual kinds
  const [triagePhase, setTriagePhase] = createSignal<'idle' | 'reasoning' | 'submitting'>('idle')
  const [triagePendingAction, setTriagePendingAction] = createSignal<'flag' | 'reject' | null>(null)
  const [triageReason, setTriageReason] = createSignal('')
  const [triageError, setTriageError] = createSignal<string | null>(null)

  const toggleCardReviews = async (cardId: string) => {
    const expanded = expandedCards()
    if (expanded.has(cardId)) {
      const next = new Set(expanded)
      next.delete(cardId)
      setExpandedCards(next)
      return
    }

    // Expand
    const next = new Set(expanded)
    next.add(cardId)
    setExpandedCards(next)

    // Fetch if not cached
    if (reviewCache()[cardId] === undefined) {
      setLoadingReviews(prev => { const s = new Set(prev); s.add(cardId); return s })
      try {
        const revs = await api.cards.reviews({ id: cardId })
        setReviewCache(prev => ({ ...prev, [cardId]: revs }))
      } catch (err) {
        console.error('Failed to fetch reviews:', err)
        setReviewCache(prev => ({ ...prev, [cardId]: [] }))
      } finally {
        setLoadingReviews(prev => { const s = new Set(prev); s.delete(cardId); return s })
      }
    }
  }
  // Build a lookup: tag → orth[] — createMemo ensures reactive tracking
  const formsByTag = createMemo(() => {
    const fs = lemmaForms() ?? []
    const map = new Map<string, string[]>()
    for (const f of (fs as Array<{ tag: string; orth: string }>)) {
      const existing = map.get(f.tag)
      if (existing) existing.push(f.orth)
      else map.set(f.tag, [f.orth])
    }
    return map
  })

  // Build a lookup: tag → audioUrl (first form with audio wins)
  const audioUrlByTag = createMemo(() => {
    const fs = lemmaForms() ?? []
    const map = new Map<string, string>()
    for (const f of (fs as Array<{ tag: string; audioUrl: string | null }>)) {
      if (f.audioUrl && !map.has(f.tag)) map.set(f.tag, f.audioUrl)
    }
    return map
  })

  const [showDelete, setShowDelete] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)

  const [editing, setEditing] = createSignal(false)
  const [editFront, setEditFront] = createSignal('')
  const [editBack, setEditBack] = createSignal('')
  const [saving, setSaving] = createSignal(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.notes.delete({ id: params.id })
      navigate('/notes')
    } finally {
      setDeleting(false)
    }
  }

  const startEditing = () => {
    const n = note()
    if (!n) return
    setEditFront(n.front ?? '')
    setEditBack(n.back ?? '')
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.notes.update({
        id: params.id,
        front: editFront(),
        back: editBack(),
      })
      setEditing(false)
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const handleTriage = async (action: 'approve' | 'flag' | 'reject', reason?: string) => {
    setTriagePhase('submitting')
    setTriageError(null)
    try {
      await api.notes.review({
        noteId: params.id,
        action,
        ...(reason ? { reason } : {}),
      })
      setTriagePhase('idle')
      setTriagePendingAction(null)
      setTriageReason('')
      refetch()
    } catch (err) {
      setTriageError(String(err))
      setTriagePhase('idle')
    }
  }

  const inputStyle = css({
    display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
    borderRadius: 'l2', border: '1px solid', borderColor: 'border',
    bg: 'bg', color: 'fg.default', outline: 'none', minH: '80px',
    fontFamily: 'inherit', resize: 'vertical',
    _focus: { borderColor: 'blue.8', boxShadow: '0 0 0 1px {colors.blue.8}' },
  })

  return (
    <div class={css({ py: '4' })}>
      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={note()}>
            {(data) => (
              <>
                {/* Header */}
                <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: '6' })}>
                  <div>
                    <div class={css({ display: 'flex', gap: '2', alignItems: 'center', flexWrap: 'wrap', mb: '2' })}>
                      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
                        {kindTitle(data().kind)}
                      </h1>
                      <span class={css({
                        display: 'inline-block', px: '2', py: '0.5', borderRadius: 'l2', fontSize: 'xs', fontWeight: 'medium',
                        bg: kindBadgeColors(data().kind).bg,
                        color: kindBadgeColors(data().kind).color,
                      })}>
                        {data().kind}
                      </span>
                      {/* Status badge — only for contextual kinds */}
                      <Show when={isContextualKind(data().kind) && statusBadgeInfo(data().status)}>
                        {(badge) => (
                          <span class={css({
                            display: 'inline-block', px: '2', py: '0.5', borderRadius: 'l2', fontSize: 'xs', fontWeight: 'medium',
                            bg: badge().bg,
                            color: badge().color,
                          })}>
                            {badge().label}
                          </span>
                        )}
                      </Show>
                    </div>
                    {/* Concept — only for contextual kinds with a conceptId */}
                    <Show when={isContextualKind(data().kind) && data().conceptId}>
                      <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                        Concept:{' '}
                        <Show
                          when={!concept.loading}
                          fallback={<Spinner size="sm" />}
                        >
                          <span class={css({ color: 'fg.default' })}>{concept()?.name ?? data().conceptId}</span>
                        </Show>
                      </p>
                    </Show>
                    <Show when={data().lemmaId}>
                      {(lemmaId) => (
                        <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                          Lemma:{' '}
                          <A href={`/lemmas/${lemmaId()}`} class={css({ color: 'blue.9', textDecoration: 'none', _hover: { textDecoration: 'underline' } })}>
                            {data().lemmaText ?? lemmaId()}
                          </A>
                        </p>
                      )}
                    </Show>
                    <Show when={lemma()?.imageUrl}>
                      {(url) => (
                        <div class={css({ mt: '3', mb: '1' })}>
                          <img
                            src={url()}
                            alt={`Mnemonic for ${data().lemmaText ?? ''}`}
                            class={css({ w: '100%', h: 'auto', borderRadius: 'l2', border: '1px solid', borderColor: 'border' })}
                          />
                          <p class={css({ fontSize: 'xs', color: 'fg.subtle', mt: '1' })}>Mnemonic</p>
                        </div>
                      )}
                    </Show>
                    <p class={css({ color: 'fg.subtle', fontSize: 'xs' })}>
                      Created {new Date(data().createdAt).toLocaleDateString()}
                      {' \u00B7 '}
                      Updated {new Date(data().updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div class={css({ display: 'flex', gap: '2' })}>
                    <Show when={data().kind === 'basic' && !editing()}>
                      <Button variant="outline" onClick={startEditing}>Edit</Button>
                    </Show>
                    <Button variant="danger" onClick={() => setShowDelete(true)}>Delete</Button>
                  </div>
                </div>

                {/* Inline triage — only for contextual kinds */}
                <Show when={isContextualKind(data().kind)}>
                  <div class={css({ mb: '6' })}>
                    <Switch>
                      <Match when={triagePhase() === 'idle'}>
                        <div class={css({ display: 'flex', gap: '2', flexWrap: 'wrap', alignItems: 'center' })}>
                          <Button variant="solid" onClick={() => handleTriage('approve')}>
                            ✅ Approve
                          </Button>
                          <Button variant="outline" onClick={() => { setTriagePendingAction('flag'); setTriagePhase('reasoning') }}>
                            🚩 Flag
                          </Button>
                          <Button variant="danger" onClick={() => { setTriagePendingAction('reject'); setTriagePhase('reasoning') }}>
                            ❌ Reject
                          </Button>
                        </div>
                        <Show when={triageError()}>
                          {(err) => (
                            <p class={css({ fontSize: 'sm', color: 'red.11', mt: '2' })}>{err()}</p>
                          )}
                        </Show>
                      </Match>
                      <Match when={triagePhase() === 'reasoning'}>
                        <div class={css({
                          p: '4', borderRadius: 'l2', bg: 'bg.subtle',
                          border: '1px solid', borderColor: 'border',
                        })}>
                          <p class={css({ fontSize: 'sm', fontWeight: 'medium', mb: '2', color: 'fg.default' })}>
                            Reason for {triagePendingAction()} (optional):
                          </p>
                          <input
                            type="text"
                            value={triageReason()}
                            onInput={(e) => setTriageReason(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const action = triagePendingAction()
                                if (action) handleTriage(action, triageReason() || undefined)
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                setTriagePhase('idle')
                                setTriagePendingAction(null)
                                setTriageReason('')
                              }
                            }}
                            placeholder="Optional reason…"
                            class={css({
                              display: 'block', w: 'full', px: '3', py: '2', mb: '3',
                              fontSize: 'sm', borderRadius: 'l2', border: '1px solid',
                              borderColor: 'border', bg: 'bg', color: 'fg.default', outline: 'none',
                              _focus: { borderColor: 'accent.9', boxShadow: '0 0 0 1px {colors.accent.9}' },
                            })}
                          />
                          <div class={css({ display: 'flex', gap: '2' })}>
                            <Button
                              variant="solid"
                              onClick={() => {
                                const action = triagePendingAction()
                                if (action) handleTriage(action, triageReason() || undefined)
                              }}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setTriagePhase('idle')
                                setTriagePendingAction(null)
                                setTriageReason('')
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </Match>
                      <Match when={triagePhase() === 'submitting'}>
                        <div class={css({ display: 'flex', alignItems: 'center', gap: '3', color: 'fg.muted' })}>
                          <Spinner size="sm" />
                          <span class={css({ fontSize: 'sm' })}>Saving…</span>
                        </div>
                      </Match>
                    </Switch>
                  </div>
                </Show>

                {/* Front/Back content — basic and gloss kinds only */}
                <Show when={data().kind === 'basic' || data().kind === 'gloss'}>
                  <Show when={editing()} fallback={
                    <div class={css({ mb: '6', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'l3', bg: 'bg.subtle' })}>
                      <div class={css({ mb: '3' })}>
                        <p class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.muted', mb: '1' })}>Front</p>
                        <p class={css({ color: 'fg.default', whiteSpace: 'pre-wrap' })}>{data().front ?? '—'}</p>
                      </div>
                      <div>
                        <p class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.muted', mb: '1' })}>Back</p>
                        <p class={css({ color: 'fg.default', whiteSpace: 'pre-wrap' })}>{data().back ?? '—'}</p>
                      </div>
                    </div>
                  }>
                    <div class={css({ mb: '6', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'l3', bg: 'bg.subtle' })}>
                      <div class={css({ mb: '3' })}>
                        <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>Front</label>
                        <textarea class={inputStyle} value={editFront()} onInput={(e) => setEditFront(e.currentTarget.value)} />
                      </div>
                      <div class={css({ mb: '3' })}>
                        <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>Back</label>
                        <textarea class={inputStyle} value={editBack()} onInput={(e) => setEditBack(e.currentTarget.value)} />
                      </div>
                      <div class={css({ display: 'flex', gap: '2' })}>
                        <Button onClick={handleSave} loading={saving()} disabled={!editFront().trim() || !editBack().trim()}>
                          Save
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                      </div>
                    </div>
                  </Show>
                </Show>

                {/* Contextual note body sections */}
                <Show when={isContextualKind(data().kind)}>
                  <Switch>
                    <Match when={data().kind === 'cloze'}>
                      <ClozeBody
                        sentenceText={data().sentenceText}
                        gaps={data().gaps ?? []}
                        explanation={data().explanation}
                      />
                    </Match>
                    <Match when={data().kind === 'choice'}>
                      <ChoiceBody
                        sentenceText={data().sentenceText}
                        front={data().front}
                        options={data().options ?? []}
                        explanation={data().explanation}
                      />
                    </Match>
                    <Match when={data().kind === 'error'}>
                      <ErrorBody
                        front={data().front}
                        back={data().back}
                        explanation={data().explanation}
                      />
                    </Match>
                    <Match when={data().kind === 'classifier'}>
                      <ClassifierBody
                        sentenceText={data().sentenceText}
                        conceptName={concept()?.name}
                        conceptLoading={concept.loading}
                        explanation={data().explanation}
                      />
                    </Match>
                  </Switch>
                </Show>

                {/* Cards / Preview tabs */}
                <div class={css({ display: 'flex', gap: '1', mb: '4', borderBottom: '1px solid', borderColor: 'border' })}>
                  {(['cards', 'preview'] as const).map((tab) => (
                    <button
                      onClick={() => setDetailTab(tab)}
                      class={css({
                        px: '4', py: '2', fontSize: 'sm', fontWeight: 'medium',
                        cursor: 'pointer', border: 'none', bg: 'transparent',
                        borderBottom: '2px solid',
                        borderBottomColor: detailTab() === tab ? 'accent.9' : 'transparent',
                        color: detailTab() === tab ? 'accent.9' : 'fg.muted',
                        mb: '-1px',
                        transition: 'all 0.15s',
                        _hover: { color: 'fg.default' },
                      })}
                    >
                      {tab === 'cards' ? `Cards (${data().cards.length})` : 'Preview'}
                    </button>
                  ))}
                </div>

                <Show when={detailTab() === 'cards'}>

                <Show
                  when={data().cards.length > 0}
                  fallback={<p class={css({ color: 'fg.muted', fontSize: 'sm' })}>No cards for this note.</p>}
                >
                  <div class={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                    <For each={data().cards}>
                      {(card) => (
                        <div class={css({
                          p: '4',
                          border: '1px solid',
                          borderColor: 'border',
                          borderRadius: 'l3',
                          bg: 'bg',
                        })}>
                          <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: '2' })}>
                            <div class={css({ display: 'flex', gap: '2', alignItems: 'center', flexWrap: 'wrap' })}>
                              <span class={css({
                                display: 'inline-block', px: '2', py: '0.5', borderRadius: 'l2', fontSize: 'xs', fontWeight: 'medium',
                                bg: 'gray.3', color: 'gray.11',
                              })}>
                                {card.kind.replace('_', ' ')}
                              </span>
                              <StateBadge state={card.state} />
                              <Show when={card.tag}>
                                <span class={css({ fontSize: 'sm', color: 'fg.muted' })}>
                                  {formatTag(card.tag ?? '')}
                                </span>
                              </Show>
                            </div>
                            <div class={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                              <span class={css({ fontSize: 'xs', color: 'fg.subtle', whiteSpace: 'nowrap' })}>
                                Due {formatDue(card.due)}
                              </span>
                              <button
                                onClick={() => toggleCardReviews(card.id)}
                                class={css({
                                  bg: 'transparent', border: 'none', cursor: 'pointer',
                                  fontSize: 'xs', color: 'fg.muted', p: '1', borderRadius: 'l1',
                                  _hover: { color: 'fg.default', bg: 'bg.subtle' },
                                  transition: 'all 0.15s',
                                })}
                                title="Toggle review history"
                              >
                                {expandedCards().has(card.id) ? '\u25BC' : '\u25B6'}
                              </button>
                            </div>
                          </div>
                          <Show when={card.kind === 'morph_form' && card.tag && (formsByTag().get(card.tag) ?? []).length > 0}>
                            <p class={css({ fontSize: 'sm', color: 'fg.default', mb: '2', fontFamily: 'monospace' })}>
                              {(formsByTag().get(card.tag!) ?? []).join(' / ')}
                            </p>
                          </Show>
                          <Show when={(card.kind === 'gloss_forward' || card.kind === 'gloss_reverse') && (data().back || data().front)}>
                            <p class={css({ fontSize: 'sm', color: 'fg.default', mb: '2' })}>
                              {card.kind === 'gloss_forward'
                                ? `${data().lemmaText ?? data().lemma} → ${data().back}`
                                : `${data().back} → ${data().lemmaText ?? data().lemma}`}
                            </p>
                          </Show>
                          <Show when={card.kind === 'basic_forward'}>
                            <p class={css({ fontSize: 'sm', color: 'fg.default', mb: '2' })}>
                              {data().front} → {data().back}
                            </p>
                          </Show>
                          <div class={css({ display: 'flex', gap: '4', fontSize: 'xs', color: 'fg.muted' })}>
                            <span>Stability: {card.stability.toFixed(1)}</span>
                            <span>Difficulty: {card.difficulty.toFixed(1)}</span>
                            <span>Reps: {card.reps}</span>
                            <span>Lapses: {card.lapses}</span>
                          </div>

                          {/* Expandable review history */}
                          <Show when={expandedCards().has(card.id)}>
                            <div class={css({ mt: '3', pt: '3', borderTop: '1px solid', borderColor: 'border' })}>
                              <Show when={loadingReviews().has(card.id)}>
                                <div class={css({ display: 'flex', justifyContent: 'center', py: '2' })}>
                                  <Spinner size="sm" />
                                </div>
                              </Show>
                              <Show when={!loadingReviews().has(card.id) && reviewCache()[card.id] !== undefined}>
                                <Show
                                  when={(reviewCache()[card.id] ?? []).length > 0}
                                  fallback={<p class={css({ fontSize: 'xs', color: 'fg.muted', fontStyle: 'italic' })}>No reviews yet</p>}
                                >
                                  <div class={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                                    <For each={reviewCache()[card.id]}>
                                      {(rev) => {
                                        const meta = ratingMeta[rev.rating as number] ?? { label: '?', color: 'fg.muted', bg: 'gray.3' }
                                        return (
                                          <div class={css({ display: 'flex', gap: '3', alignItems: 'center', fontSize: 'xs', py: '1' })}>
                                            <span class={css({ color: 'fg.muted', minW: '50px' })}>
                                              {new Date(rev.reviewedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            </span>
                                            <span class={css({
                                              display: 'inline-block', px: '1.5', py: '0.5', borderRadius: 'l1',
                                              fontSize: 'xs', fontWeight: 'medium', bg: meta.bg, color: meta.color, minW: '40px',
                                              textAlign: 'center',
                                            })}>
                                              {meta.label}
                                            </span>
                                            <span class={css({ color: 'fg.muted' })}>
                                              S: {rev.stabilityAfter.toFixed(1)}d
                                            </span>
                                            <span class={css({ color: 'fg.muted' })}>
                                              +{rev.scheduledDays}d
                                            </span>
                                          </div>
                                        )
                                      }}
                                    </For>
                                  </div>
                                </Show>
                              </Show>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                </Show>

                {/* Preview tab */}
                <Show when={detailTab() === 'preview' && data().cards.length > 0}>
                  {(() => {
                    const [showAll, setShowAll] = createSignal(false)
                    const PREVIEW_LIMIT = 5
                    const allCards = () => data().cards as CardItem[]
                    const visibleCards = () => showAll() || allCards().length <= PREVIEW_LIMIT
                      ? allCards()
                      : allCards().slice(0, PREVIEW_LIMIT)

                    return (
                      <>
                        <div class={css({ display: 'flex', flexDirection: 'column', gap: '3', mb: '6' })}>
                          <For each={visibleCards()}>
                            {(card) => {
                              // Contextual card kinds get their own preview renderer
                              if ((CONTEXTUAL_CARD_KINDS as readonly string[]).includes(card.kind)) {
                                return (
                                  <ContextualCardPreview
                                    kind={card.kind}
                                    sentenceText={data().sentenceText}
                                    front={data().front}
                                    back={data().back}
                                    gaps={data().gaps}
                                    options={data().options}
                                    explanation={data().explanation}
                                    conceptName={concept()?.name}
                                    conceptLoading={concept.loading}
                                  />
                                )
                              }
                              return (
                                <QuizCardPreview
                                  kind={card.kind}
                                  tag={card.tag ?? null}
                                  lemmaText={data().lemmaText ?? null}
                                  front={data().front ?? null}
                                  back={data().back ?? null}
                                  forms={card.kind === 'morph_form' && card.tag ? (formsByTag().get(card.tag) ?? []) : []}
                                  audioUrl={card.kind === 'morph_form' && card.tag ? (audioUrlByTag().get(card.tag) ?? null) : null}
                                />
                              )
                            }}
                          </For>
                        </div>
                        <Show when={allCards().length > PREVIEW_LIMIT && !showAll()}>
                          <button
                            onClick={() => setShowAll(true)}
                            class={css({
                              bg: 'transparent', border: 'none', cursor: 'pointer',
                              fontSize: 'sm', color: 'blue.9', p: '0', mb: '6',
                              _hover: { textDecoration: 'underline' },
                            })}
                          >
                            Show all {allCards().length} cards
                          </button>
                        </Show>
                      </>
                    )
                  })()}
                </Show>

                <ConfirmDialog
                  open={showDelete()}
                  title="Delete note"
                  description="This will delete the note and all its cards. Review history will also be removed."
                  confirmLabel="Delete"
                  onConfirm={handleDelete}
                  onCancel={() => setShowDelete(false)}
                  loading={deleting()}
                />
              </>
            )}
          </Show>
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
