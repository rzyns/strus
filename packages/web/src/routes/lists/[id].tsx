import { createResource, createSignal, createMemo, For, Show, Suspense, ErrorBoundary } from 'solid-js'
import { useParams, useNavigate, A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import type { LemmaItem } from '../../api/types'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { JsonViewer } from '../../components/JsonViewer'
import * as Table from '../../components/ui/table'

const POS_OPTIONS = ['subst', 'verb', 'adj', 'adv'] as const

export default function ListDetail() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [list, { refetch: refetchList }] = createResource(() => api.lists.get({ id: params.id }))
  const [lemmas, { refetch: refetchLemmas }] = createResource<LemmaItem[]>(() => api.lemmas.list({ listId: params.id }))

  const [showDeleteList, setShowDeleteList] = createSignal(false)
  const [deletingList, setDeletingList] = createSignal(false)

  const [showAddForm, setShowAddForm] = createSignal(false)
  const [addTab, setAddTab] = createSignal<'new' | 'existing'>('new')
  const [word, setWord] = createSignal('')
  const [pos, setPos] = createSignal<string>('subst')
  const [source, setSource] = createSignal<string>('morfeusz')
  const [adding, setAdding] = createSignal(false)

  const [allLemmas] = createResource<LemmaItem[], true>(
    () => showAddForm() || undefined,
    () => api.lemmas.list({}),
  )
  const [existingSearch, setExistingSearch] = createSignal('')
  const [addingExistingId, setAddingExistingId] = createSignal<string | null>(null)

  // createMemo — not a plain function — so SolidJS caches the result and only
  // recomputes when allLemmas(), lemmas(), or existingSearch() changes.
  // This function is called twice in JSX; without memo it would compute twice
  // per reactive update (including the Set construction over all lemmas).
  const filteredExistingLemmas = createMemo(() => {
    const all = allLemmas() ?? []
    const currentIds = new Set((lemmas() ?? []).map((l) => l.id))
    const search = existingSearch().toLowerCase().trim()
    return all.filter((l) => !currentIds.has(l.id) && (!search || l.lemma.toLowerCase().includes(search)))
  })

  const handleAddExisting = async (lemmaId: string) => {
    setAddingExistingId(lemmaId)
    try {
      await api.lists.addLemma({ listId: params.id, lemmaId })
      refetchLemmas()
    } finally {
      setAddingExistingId(null)
    }
  }

  const handleDeleteList = async () => {
    setDeletingList(true)
    try {
      await api.lists.delete({ id: params.id })
      navigate('/lists')
    } finally {
      setDeletingList(false)
    }
  }

  const handleAddLemma = async () => {
    const w = word().trim()
    if (!w) return
    setAdding(true)
    try {
      await api.lemmas.create({
        lemma: w,
        pos: pos(),
        source: source() as 'morfeusz' | 'manual',
        listId: params.id,
      })
      setWord('')
      setShowAddForm(false)
      refetchLemmas()
    } finally {
      setAdding(false)
    }
  }

  const inputStyle = css({
    px: '3', py: '2', fontSize: 'sm', borderRadius: 'l2',
    border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg.default',
    outline: 'none', _focus: { borderColor: 'blue.8', boxShadow: '0 0 0 1px {colors.blue.8}' },
  })

  const selectStyle = css({
    px: '3', py: '2', fontSize: 'sm', borderRadius: 'l2',
    border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg.default',
  })

  return (
    <div class={css({ py: '4' })}>
      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetchList} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={list()}>
            {(data) => (
              <>
                <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: '6' })}>
                  <div>
                    <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '1', color: 'fg.default' })}>{data().name}</h1>
                    <Show when={data().description}>
                      <p class={css({ color: 'fg.muted', mb: '1' })}>{data().description}</p>
                    </Show>
                    <p class={css({ color: 'fg.subtle', fontSize: 'sm' })}>
                      Created {new Date(data().createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div class={css({ display: 'flex', gap: '2' })}>
                    <A href={`/import?listId=${params.id}`} class={css({ textDecoration: 'none' })}>
                      <Button variant="outline">Import text</Button>
                    </A>
                    <JsonViewer data={list()} label="list JSON" />
                    <Button variant="danger" onClick={() => setShowDeleteList(true)}>Delete list</Button>
                  </div>
                </div>

                <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '4' })}>
                  <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', color: 'fg.default' })}>Lemmas</h2>
                  <Button variant={showAddForm() ? 'ghost' : 'outline'} size="sm" onClick={() => setShowAddForm(!showAddForm())}>
                    {showAddForm() ? 'Cancel' : 'Add lemma'}
                  </Button>
                </div>

                <Show when={showAddForm()}>
                  <div class={css({ mb: '4', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'l3', bg: 'bg.subtle' })}>
                    <div class={css({ display: 'flex', gap: '1', mb: '3' })}>
                      <button
                        class={css({
                          px: '3', py: '1.5', fontSize: 'sm', fontWeight: 'medium', borderRadius: 'l2', cursor: 'pointer',
                          border: '1px solid', borderColor: addTab() === 'new' ? 'blue.8' : 'border',
                          bg: addTab() === 'new' ? 'blue.3' : 'transparent', color: addTab() === 'new' ? 'blue.11' : 'fg.muted',
                        })}
                        onClick={() => setAddTab('new')}
                      >
                        New word
                      </button>
                      <button
                        class={css({
                          px: '3', py: '1.5', fontSize: 'sm', fontWeight: 'medium', borderRadius: 'l2', cursor: 'pointer',
                          border: '1px solid', borderColor: addTab() === 'existing' ? 'blue.8' : 'border',
                          bg: addTab() === 'existing' ? 'blue.3' : 'transparent', color: addTab() === 'existing' ? 'blue.11' : 'fg.muted',
                        })}
                        onClick={() => setAddTab('existing')}
                      >
                        Add existing
                      </button>
                    </div>

                    <Show when={addTab() === 'new'}>
                      <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap', alignItems: 'flex-end' })}>
                        <div>
                          <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>Word</label>
                          <input class={inputStyle} value={word()} onInput={(e) => setWord(e.currentTarget.value)} placeholder="e.g. dom" />
                        </div>
                        <div>
                          <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>POS</label>
                          <select class={selectStyle} value={pos()} onChange={(e) => setPos(e.currentTarget.value)}>
                            <For each={[...POS_OPTIONS]}>{(p) => <option value={p}>{p}</option>}</For>
                          </select>
                        </div>
                        <div>
                          <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>Source</label>
                          <select class={selectStyle} value={source()} onChange={(e) => setSource(e.currentTarget.value)}>
                            <option value="morfeusz">morfeusz</option>
                            <option value="manual">manual</option>
                          </select>
                        </div>
                        <Button onClick={handleAddLemma} loading={adding()} disabled={!word().trim()}>
                          Add
                        </Button>
                      </div>
                    </Show>

                    <Show when={addTab() === 'existing'}>
                      <div>
                        <input
                          class={inputStyle}
                          value={existingSearch()}
                          onInput={(e) => setExistingSearch(e.currentTarget.value)}
                          placeholder="Filter lemmas..."
                          style={{ width: '100%', "margin-bottom": '8px' }}
                        />
                        <Show when={!allLemmas.loading} fallback={<div class={css({ py: '4', textAlign: 'center' })}><Spinner /></div>}>
                          <Show
                            when={filteredExistingLemmas().length > 0}
                            fallback={
                              <p class={css({ color: 'fg.muted', fontSize: 'sm', py: '3', textAlign: 'center' })}>
                                {(allLemmas() ?? []).length === 0 ? 'No lemmas exist yet' : existingSearch() ? 'No matching lemmas' : 'All lemmas already in list'}
                              </p>
                            }
                          >
                            <div class={css({ maxHeight: '200px', overflowY: 'auto', border: '1px solid', borderColor: 'border', borderRadius: 'l2' })}>
                              <For each={filteredExistingLemmas()}>
                                {(lemma) => (
                                  <div class={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: '3', py: '2', borderBottom: '1px solid', borderColor: 'border', _last: { borderBottom: 'none' } })}>
                                    <div class={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
                                      <span class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.default' })}>{lemma.lemma}</span>
                                      <Badge variant="pos" value={lemma.pos} />
                                    </div>
                                    <Button size="sm" variant="outline" onClick={() => handleAddExisting(lemma.id)} loading={addingExistingId() === lemma.id} disabled={addingExistingId() !== null}>
                                      Add
                                    </Button>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>

                <Suspense fallback={<Spinner />}>
                  <Show when={lemmas()}>
                    {(lemmaData) => (
                      <Show
                        when={lemmaData().length > 0}
                        fallback={<EmptyState heading="No lemmas in this list" description="Add lemmas or import text to get started." action={{ label: 'Add lemma', onClick: () => setShowAddForm(true) }} />}
                      >
                        <Table.Root>
                          <Table.Head>
                            <Table.Row>
                              <Table.Header>Lemma</Table.Header>
                              <Table.Header>POS</Table.Header>
                              <Table.Header>Source</Table.Header>
                              <Table.Header>Created</Table.Header>
                            </Table.Row>
                          </Table.Head>
                          <Table.Body>
                            <For each={lemmaData()}>
                              {(lemma) => (
                                <Table.Row>
                                  <Table.Cell>
                                    <A href={`/lemmas/${lemma.id}`} class={css({ color: 'blue.9', textDecoration: 'none', fontWeight: 'medium', _hover: { textDecoration: 'underline' } })}>
                                      {lemma.lemma}
                                    </A>
                                  </Table.Cell>
                                  <Table.Cell><Badge variant="pos" value={lemma.pos} /></Table.Cell>
                                  <Table.Cell><Badge variant="source" value={lemma.source} /></Table.Cell>
                                  <Table.Cell class={css({ color: 'fg.muted', fontSize: 'sm' })}>
                                    {new Date(lemma.createdAt).toLocaleDateString()}
                                  </Table.Cell>
                                </Table.Row>
                              )}
                            </For>
                          </Table.Body>
                        </Table.Root>
                      </Show>
                    )}
                  </Show>
                </Suspense>

                <ConfirmDialog
                  open={showDeleteList()}
                  title="Delete list"
                  description={`Delete "${data().name}"? Lemma associations will be removed but lemmas themselves will not be deleted.`}
                  confirmLabel="Delete"
                  onConfirm={handleDeleteList}
                  onCancel={() => setShowDeleteList(false)}
                  loading={deletingList()}
                />
              </>
            )}
          </Show>
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
