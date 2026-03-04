import { createResource, createSignal, Show, Suspense, ErrorBoundary, Switch, Match, For } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { NounTable } from '../../components/paradigm/NounTable'
import { VerbTable } from '../../components/paradigm/VerbTable'
import { AdjTable } from '../../components/paradigm/AdjTable'
import { FlatFormTable } from '../../components/paradigm/FlatFormTable'
import { JsonViewer } from '../../components/JsonViewer'

export default function LemmaDetail() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [lemma, { refetch: refetchLemma }] = createResource(() => api.lemmas.get({ id: params.id }))
  const [forms, { refetch: refetchForms }] = createResource(() => api.lemmas.forms({ id: params.id }))
  const [glossNotes, { refetch: refetchGlosses }] = createResource(
    () => params.id,
    (id) => api.notes.list({ kind: 'gloss', lemmaId: id })
  )

  const [showDelete, setShowDelete] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [generatingImage, setGeneratingImage] = createSignal(false)
  const [imageError, setImageError] = createSignal<string | null>(null)
  const [generatingAudio, setGeneratingAudio] = createSignal<Set<string>>(new Set())

  // Gloss add form state
  const [newGloss, setNewGloss] = createSignal('')
  const [addingGloss, setAddingGloss] = createSignal(false)
  const [glossError, setGlossError] = createSignal<string | null>(null)

  // Gloss delete state
  const [deletingGlossId, setDeletingGlossId] = createSignal<string | null>(null)
  const [glossToDelete, setGlossToDelete] = createSignal<{ id: string; back: string } | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.lemmas.delete({ id: params.id })
      navigate('/lemmas')
    } finally {
      setDeleting(false)
    }
  }

  const handleAddGloss = async (e: Event) => {
    e.preventDefault()
    const translation = newGloss().trim()
    if (!translation) return
    setAddingGloss(true)
    setGlossError(null)
    try {
      await api.notes.create({ kind: 'gloss', lemmaId: params.id, back: translation })
      setNewGloss('')
      refetchGlosses()
    } catch (err) {
      setGlossError(String(err))
    } finally {
      setAddingGloss(false)
    }
  }

  const handleDeleteGloss = async () => {
    const g = glossToDelete()
    if (!g) return
    setDeletingGlossId(g.id)
    try {
      await api.notes.delete({ id: g.id })
      refetchGlosses()
    } finally {
      setDeletingGlossId(null)
      setGlossToDelete(null)
    }
  }

  return (
    <div class={css({ py: '4' })}>
      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={() => { refetchLemma(); refetchForms(); refetchGlosses() }} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={lemma()}>
            {(data) => (
              <>
                <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: '6' })}>
                  <div>
                    <h1 class={css({ fontSize: '3xl', fontWeight: 'bold', fontFamily: 'monospace', mb: '2', color: 'fg.default' })}>
                      {data().lemma}
                    </h1>
                    <div class={css({ display: 'flex', gap: '2', mb: '2', flexWrap: 'wrap' })}>
                      <Badge variant="pos" value={data().pos} />
                      <Badge variant="source" value={data().source} />
                    </div>
                    <Show when={data().notes}>
                      <p class={css({ color: 'fg.muted', mb: '2', fontSize: 'sm' })}>{data().notes}</p>
                    </Show>
                    <p class={css({ color: 'fg.subtle', fontSize: 'xs' })}>
                      Added {new Date(data().createdAt).toLocaleDateString()}
                      {' \u00B7 '}
                      Updated {new Date(data().updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div class={css({ display: 'flex', gap: '4', alignItems: 'flex-start' })}>
                    <Show
                      when={data().imageUrl}
                      fallback={
                        <div class={css({ display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={generatingImage()}
                            onClick={async () => {
                              setGeneratingImage(true)
                              setImageError(null)
                              try {
                                await api.lemmas.generateImage({ id: params.id })
                                refetchLemma()
                              } catch (err) {
                                setImageError(String(err))
                              } finally {
                                setGeneratingImage(false)
                              }
                            }}
                          >
                            {generatingImage() ? 'Generating…' : 'Generate image'}
                          </Button>
                          <Show when={imageError()}>
                            <span class={css({ fontSize: 'xs', color: 'red.9', mt: '1' })}>{imageError()}</span>
                          </Show>
                        </div>
                      }
                    >
                      {(url) => (
                        <div class={css({ display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
                          <img
                            src={url()}
                            alt={`Mnemonic for ${data().lemma}`}
                            class={css({ maxW: '200px', maxH: '200px', borderRadius: 'lg', border: '1px solid', borderColor: 'border.subtle' })}
                          />
                          <span class={css({ fontSize: 'xs', color: 'fg.muted', mt: '1' })}>Mnemonic</span>
                        </div>
                      )}
                    </Show>
                    <div class={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                      <JsonViewer data={{ lemma: data(), forms: forms() }} label="lemma JSON" />
                      <Button variant="danger" onClick={() => setShowDelete(true)}>Delete</Button>
                    </div>
                  </div>
                </div>

                {/* ── Glosses ────────────────────────────────────────────── */}
                <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '3', color: 'fg.default' })}>Glosses</h2>

                <Suspense fallback={<Spinner />}>
                  <div class={css({ mb: '6' })}>
                    <Show when={(glossNotes() ?? []).length > 0}>
                      <div class={css({ display: 'flex', flexDirection: 'column', gap: '2', mb: '4' })}>
                        <For each={glossNotes()}>
                          {(note) => (
                            <div class={css({
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              px: '4', py: '3', borderRadius: 'md',
                              bg: 'bg.subtle', border: '1px solid', borderColor: 'border.subtle',
                            })}>
                              <span class={css({ fontSize: 'md', color: 'fg.default' })}>{note.back}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setGlossToDelete({ id: note.id, back: note.back ?? '' })}
                                disabled={deletingGlossId() === note.id}
                              >
                                {deletingGlossId() === note.id ? '…' : 'Remove'}
                              </Button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    {/* Add gloss form */}
                    <form onSubmit={handleAddGloss} class={css({ display: 'flex', gap: '2', alignItems: 'flex-start' })}>
                      <input
                        type="text"
                        placeholder="Add translation…"
                        value={newGloss()}
                        onInput={(e) => setNewGloss(e.currentTarget.value)}
                        disabled={addingGloss()}
                        class={css({
                          flex: '1', px: '3', py: '2', borderRadius: 'md', fontSize: 'sm',
                          border: '1px solid', borderColor: 'border.default',
                          bg: 'bg.default', color: 'fg.default',
                          _focus: { outline: '2px solid', outlineColor: 'accent.default', outlineOffset: '2px' },
                          _disabled: { opacity: '0.5', cursor: 'not-allowed' },
                        })}
                      />
                      <Button type="submit" variant="solid" size="sm" disabled={addingGloss() || newGloss().trim() === ''}>
                        {addingGloss() ? 'Adding…' : 'Add'}
                      </Button>
                    </form>
                    <Show when={glossError()}>
                      <p class={css({ color: 'red.9', fontSize: 'sm', mt: '1' })}>{glossError()}</p>
                    </Show>
                  </div>
                </Suspense>

                {/* ── Paradigm ───────────────────────────────────────────── */}
                <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '4', color: 'fg.default' })}>Paradigm</h2>

                <Suspense fallback={<Spinner />}>
                  <Show when={forms()}>
                    {(fs) => (
                      <Show
                        when={fs().length > 0}
                        fallback={
                          <EmptyState
                            heading="No forms"
                            description={data().source === 'manual' ? 'This lemma uses manual source \u2014 forms must be added manually.' : 'No morphological forms were generated.'}
                          />
                        }
                      >
                        <Switch fallback={<FlatFormTable forms={fs()} />}>
                          <Match when={data().pos === 'subst'}><NounTable forms={fs()} /></Match>
                          <Match when={data().pos === 'verb'}><VerbTable forms={fs()} /></Match>
                          <Match when={data().pos === 'adj'}><AdjTable forms={fs()} /></Match>
                        </Switch>
                      </Show>
                    )}
                  </Show>
                </Suspense>

                {/* ── Audio ────────────────────────────────────────────── */}
                <Suspense fallback={<Spinner />}>
                  <Show when={forms()}>
                    {(fs) => {
                      // Deduplicate by orth — show one row per unique surface form
                      type FormEntry = ReturnType<typeof fs>[number]
                      const uniqueForms = () => {
                        const seen = new Map<string, FormEntry>()
                        for (const f of fs()) {
                          if (!seen.has(f.orth)) seen.set(f.orth, f)
                        }
                        return [...seen.values()].sort((a, b) => a.orth.localeCompare(b.orth, 'pl'))
                      }
                      return (
                        <Show when={uniqueForms().length > 0}>
                          <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '3', mt: '6', color: 'fg.default' })}>Audio</h2>
                          <div class={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                            <For each={uniqueForms()}>
                              {(form) => (
                                <div class={css({
                                  display: 'flex', alignItems: 'center', gap: '3',
                                  px: '4', py: '2', borderRadius: 'md',
                                  bg: 'bg.subtle', border: '1px solid', borderColor: 'border.subtle',
                                })}>
                                  <span class={css({ fontFamily: 'monospace', fontSize: 'sm', minW: '120px' })}>{form.orth}</span>
                                  <Show
                                    when={form.audioUrl}
                                    fallback={
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={generatingAudio().has(form.id)}
                                        onClick={async () => {
                                          setGeneratingAudio((prev) => new Set([...prev, form.id]))
                                          try {
                                            await api.forms.generateAudio({ id: form.id })
                                            refetchForms()
                                          } finally {
                                            setGeneratingAudio((prev) => {
                                              const next = new Set(prev)
                                              next.delete(form.id)
                                              return next
                                            })
                                          }
                                        }}
                                      >
                                        {generatingAudio().has(form.id) ? 'Generating…' : 'Generate'}
                                      </Button>
                                    }
                                  >
                                    {(url) => <audio controls preload="none" src={url()} class={css({ h: '32px' })} />}
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      )
                    }}
                  </Show>
                </Suspense>

                <ConfirmDialog
                  open={showDelete()}
                  title="Delete lemma"
                  description={`Delete "${data().lemma}"? This will also delete all morphological forms and learning targets.`}
                  confirmLabel="Delete"
                  onConfirm={handleDelete}
                  onCancel={() => setShowDelete(false)}
                  loading={deleting()}
                />

                <ConfirmDialog
                  open={glossToDelete() !== null}
                  title="Remove gloss"
                  description={`Remove translation "${glossToDelete()?.back}"? The gloss_forward and gloss_reverse cards will also be deleted.`}
                  confirmLabel="Remove"
                  onConfirm={handleDeleteGloss}
                  onCancel={() => setGlossToDelete(null)}
                  loading={deletingGlossId() !== null}
                />
              </>
            )}
          </Show>
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
