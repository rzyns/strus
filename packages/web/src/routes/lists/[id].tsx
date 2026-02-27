import { createResource, createSignal, For, Show, Suspense, ErrorBoundary } from 'solid-js'
import { useParams, useNavigate, A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'

const POS_OPTIONS = ['subst', 'verb', 'adj', 'adv'] as const

export default function ListDetail() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [list, { refetch: refetchList }] = createResource(() => api.lists.get({ id: params.id }))
  const [lemmas, { refetch: refetchLemmas }] = createResource(() => api.lemmas.list({ listId: params.id }))

  const [showDeleteList, setShowDeleteList] = createSignal(false)
  const [deletingList, setDeletingList] = createSignal(false)

  const [showAddForm, setShowAddForm] = createSignal(false)
  const [word, setWord] = createSignal('')
  const [pos, setPos] = createSignal<string>('subst')
  const [source, setSource] = createSignal<string>('morfeusz')
  const [adding, setAdding] = createSignal(false)

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

  return (
    <div class={css({ py: '4' })}>
      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetchList} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={list()}>
            {(data) => (
              <>
                <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: '6' })}>
                  <div>
                    <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '1' })}>{data().name}</h1>
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
                    <Button variant="danger" onClick={() => setShowDeleteList(true)}>Delete list</Button>
                  </div>
                </div>

                <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '4' })}>
                  <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold' })}>Lemmas</h2>
                  <Button variant={showAddForm() ? 'ghost' : 'outline'} size="sm" onClick={() => setShowAddForm(!showAddForm())}>
                    {showAddForm() ? 'Cancel' : 'Add lemma'}
                  </Button>
                </div>

                <Show when={showAddForm()}>
                  <div class={css({ mb: '4', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'lg', bg: 'bg.subtle' })}>
                    <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap', alignItems: 'flex-end' })}>
                      <div>
                        <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1' })}>Word</label>
                        <input
                          class={css({
                            px: '3', py: '2', fontSize: 'sm', borderRadius: 'md',
                            border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg',
                            outline: 'none', _focus: { borderColor: 'primary' },
                          })}
                          value={word()}
                          onInput={(e) => setWord(e.currentTarget.value)}
                          placeholder="e.g. dom"
                        />
                      </div>
                      <div>
                        <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1' })}>POS</label>
                        <select
                          class={css({
                            px: '3', py: '2', fontSize: 'sm', borderRadius: 'md',
                            border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg',
                          })}
                          value={pos()}
                          onChange={(e) => setPos(e.currentTarget.value)}
                        >
                          <For each={[...POS_OPTIONS]}>{(p) => <option value={p}>{p}</option>}</For>
                        </select>
                      </div>
                      <div>
                        <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1' })}>Source</label>
                        <select
                          class={css({
                            px: '3', py: '2', fontSize: 'sm', borderRadius: 'md',
                            border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg',
                          })}
                          value={source()}
                          onChange={(e) => setSource(e.currentTarget.value)}
                        >
                          <option value="morfeusz">morfeusz</option>
                          <option value="manual">manual</option>
                        </select>
                      </div>
                      <Button onClick={handleAddLemma} loading={adding()} disabled={!word().trim()}>
                        Add
                      </Button>
                    </div>
                  </div>
                </Show>

                <Suspense fallback={<Spinner />}>
                  <Show when={lemmas()}>
                    {(lemmaData) => (
                      <Show
                        when={lemmaData().length > 0}
                        fallback={<EmptyState heading="No lemmas in this list" description="Add lemmas or import text to get started." action={{ label: 'Add lemma', onClick: () => setShowAddForm(true) }} />}
                      >
                        <table class={css({ w: 'full', borderCollapse: 'collapse' })}>
                          <thead>
                            <tr class={css({ borderBottom: '2px solid', borderColor: 'border' })}>
                              <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Lemma</th>
                              <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>POS</th>
                              <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Source</th>
                              <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Created</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={lemmaData()}>
                              {(lemma) => (
                                <tr class={css({ borderBottom: '1px solid', borderColor: 'border', _hover: { bg: 'bg.subtle' } })}>
                                  <td class={css({ p: '3' })}>
                                    <A href={`/lemmas/${lemma.id}`} class={css({ color: 'primary', textDecoration: 'none', fontWeight: 'medium', _hover: { textDecoration: 'underline' } })}>
                                      {lemma.lemma}
                                    </A>
                                  </td>
                                  <td class={css({ p: '3' })}><Badge variant="pos" value={lemma.pos} /></td>
                                  <td class={css({ p: '3' })}><Badge variant="source" value={lemma.source} /></td>
                                  <td class={css({ p: '3', color: 'fg.muted', fontSize: 'sm' })}>
                                    {new Date(lemma.createdAt).toLocaleDateString()}
                                  </td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
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
