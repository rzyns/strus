import { createResource, createSignal, createMemo, For, Show, Suspense, ErrorBoundary } from 'solid-js'
import { useParams, useNavigate, A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { formatTag } from '../../utils/tag-label'

const FSRS_STATE_LABELS: Record<number, string> = {
  0: 'New',
  1: 'Learning',
  2: 'Review',
  3: 'Relearning',
}

function StateBadge(props: { state: number }) {
  const color = () => {
    switch (props.state) {
      case 0: return { bg: 'gray.3', fg: 'gray.11' }
      case 1: return { bg: 'amber.3', fg: 'amber.11' }
      case 2: return { bg: 'green.3', fg: 'green.11' }
      case 3: return { bg: 'red.3', fg: 'red.11' }
      default: return { bg: 'gray.3', fg: 'gray.11' }
    }
  }
  return (
    <span class={css({
      display: 'inline-block',
      px: '2',
      py: '0.5',
      borderRadius: 'l2',
      fontSize: 'xs',
      fontWeight: 'medium',
      bg: color().bg,
      color: color().fg,
    })}>
      {FSRS_STATE_LABELS[props.state] ?? `State ${props.state}`}
    </span>
  )
}

function formatDue(iso: string): string {
  const due = new Date(iso)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`
  if (diffDays === -1) return 'yesterday'
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  return `in ${diffDays}d`
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
                            {lemmaId()}
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
                            <span class={css({ fontSize: 'xs', color: 'fg.subtle', whiteSpace: 'nowrap' })}>
                              Due {formatDue(card.due)}
                            </span>
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
                        </div>
                      )}
                    </For>
                  </div>
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
