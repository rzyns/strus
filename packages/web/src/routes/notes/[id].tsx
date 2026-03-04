import { createResource, createSignal, createMemo, For, Show, Suspense, ErrorBoundary, type JSX } from 'solid-js'
import { useParams, useNavigate, A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
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
// Quiz card preview — shows both sides of a card as it would appear in quiz
// ---------------------------------------------------------------------------

interface QuizCardPreviewProps {
  kind: string
  tag: string | null
  lemmaText: string | null
  front: string | null
  back: string | null
  forms: string[]
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
    </div>
  )
}

export default function NoteDetail() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [note, { refetch }] = createResource(() => api.notes.get({ id: params.id }))
  // Fetch morph forms so we can show the answer alongside each morph_form card
  // Source returns undefined when no lemmaId — SolidJS skips the fetcher in that case
  const [lemmaForms] = createResource(
    () => note()?.lemmaId ?? undefined,
    (lemmaId: string) => api.lemmas.forms({ id: lemmaId })
  )

  // Review history expansion state
  const [expandedCards, setExpandedCards] = createSignal<Set<string>>(new Set())
  const [reviewCache, setReviewCache] = createSignal<Record<string, any[]>>({})
  const [loadingReviews, setLoadingReviews] = createSignal<Set<string>>(new Set())

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
        setReviewCache(prev => ({ ...prev, [cardId]: revs as any[] }))
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
                    <div class={css({ display: 'flex', gap: '2', alignItems: 'center', mb: '2' })}>
                      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
                        {data().kind === 'basic' ? 'Basic Note' : data().kind === 'morph' ? 'Morph Note' : 'Gloss Note'}
                      </h1>
                      <span class={css({
                        display: 'inline-block', px: '2', py: '0.5', borderRadius: 'l2', fontSize: 'xs', fontWeight: 'medium',
                        bg: data().kind === 'morph' ? 'blue.3' : data().kind === 'basic' ? 'green.3' : 'purple.3',
                        color: data().kind === 'morph' ? 'blue.11' : data().kind === 'basic' ? 'green.11' : 'purple.11',
                      })}>
                        {data().kind}
                      </span>
                    </div>
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

                {/* Front/Back content */}
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

                {/* Cards section */}
                <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '4', color: 'fg.default' })}>
                  Cards ({data().cards.length})
                </h2>

                <Show
                  when={data().cards.length > 0}
                  fallback={<p class={css({ color: 'fg.muted', fontSize: 'sm' })}>No cards for this note.</p>}
                >
                  <div class={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                    <For each={data().cards}>
                      {(card: any) => (
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
                                  {formatTag(card.tag)}
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
                                      {(rev: any) => {
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

                {/* Preview section */}
                <Show when={data().cards.length > 0}>
                  {(() => {
                    const [showAll, setShowAll] = createSignal(false)
                    const PREVIEW_LIMIT = 5
                    const allCards = () => data().cards as any[]
                    const visibleCards = () => showAll() || allCards().length <= PREVIEW_LIMIT
                      ? allCards()
                      : allCards().slice(0, PREVIEW_LIMIT)

                    return (
                      <>
                        <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '4', mt: '8', color: 'fg.default' })}>
                          Preview
                        </h2>
                        <div class={css({ display: 'flex', flexDirection: 'column', gap: '3', mb: '6' })}>
                          <For each={visibleCards()}>
                            {(card: any) => (
                              <QuizCardPreview
                                kind={card.kind}
                                tag={card.tag ?? null}
                                lemmaText={data().lemmaText ?? null}
                                front={data().front ?? null}
                                back={data().back ?? null}
                                forms={card.kind === 'morph_form' && card.tag ? (formsByTag().get(card.tag) ?? []) : []}
                              />
                            )}
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
