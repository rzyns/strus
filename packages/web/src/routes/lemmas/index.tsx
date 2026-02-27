import { createResource, createSignal, createMemo, For, Show, Suspense, ErrorBoundary } from 'solid-js'
import { A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'

const POS_OPTIONS = ['', 'subst', 'verb', 'adj', 'adv'] as const

export default function LemmasIndex() {
  const [lemmas, { refetch }] = createResource(() => api.lemmas.list({}))
  const [search, setSearch] = createSignal('')
  const [posFilter, setPosFilter] = createSignal('')
  const [sourceFilter, setSourceFilter] = createSignal('')
  const [deleteId, setDeleteId] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)

  const [showAddForm, setShowAddForm] = createSignal(false)
  const [word, setWord] = createSignal('')
  const [pos, setPos] = createSignal('subst')
  const [source, setSource] = createSignal('morfeusz')
  const [adding, setAdding] = createSignal(false)

  const filtered = createMemo(() => {
    const data = lemmas()
    if (!data) return []
    const s = search().toLowerCase()
    return data.filter((l) => {
      if (s && !l.lemma.toLowerCase().includes(s)) return false
      if (posFilter() && l.pos !== posFilter()) return false
      if (sourceFilter() && l.source !== sourceFilter()) return false
      return true
    })
  })

  const handleDelete = async () => {
    const id = deleteId()
    if (!id) return
    setDeleting(true)
    try {
      await api.lemmas.delete({ id })
      setDeleteId(null)
      refetch()
    } finally {
      setDeleting(false)
    }
  }

  const handleAdd = async () => {
    const w = word().trim()
    if (!w) return
    setAdding(true)
    try {
      await api.lemmas.create({
        lemma: w,
        pos: pos(),
        source: source() as 'morfeusz' | 'manual',
      })
      setWord('')
      setShowAddForm(false)
      refetch()
    } finally {
      setAdding(false)
    }
  }

  return (
    <div class={css({ py: '4' })}>
      <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '6' })}>
        <h1 class={css({ fontSize: '2xl', fontWeight: 'bold' })}>Lemmas</h1>
        <Button variant={showAddForm() ? 'ghost' : 'solid'} onClick={() => setShowAddForm(!showAddForm())}>
          {showAddForm() ? 'Cancel' : 'Add lemma'}
        </Button>
      </div>

      <Show when={showAddForm()}>
        <div class={css({ mb: '6', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'lg', bg: 'bg.subtle' })}>
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
                <option value="subst">subst</option>
                <option value="verb">verb</option>
                <option value="adj">adj</option>
                <option value="adv">adv</option>
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
            <Button onClick={handleAdd} loading={adding()} disabled={!word().trim()}>
              Add
            </Button>
          </div>
        </div>
      </Show>

      <div class={css({ display: 'flex', gap: '3', mb: '4', flexWrap: 'wrap' })}>
        <input
          class={css({
            px: '3', py: '2', fontSize: 'sm', borderRadius: 'md',
            border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg',
            outline: 'none', _focus: { borderColor: 'primary' }, flex: '1', minW: '200px',
          })}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          placeholder="Search lemmas..."
        />
        <select
          class={css({
            px: '3', py: '2', fontSize: 'sm', borderRadius: 'md',
            border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg',
          })}
          value={posFilter()}
          onChange={(e) => setPosFilter(e.currentTarget.value)}
        >
          <For each={[...POS_OPTIONS]}>
            {(p) => <option value={p}>{p || 'All POS'}</option>}
          </For>
        </select>
        <select
          class={css({
            px: '3', py: '2', fontSize: 'sm', borderRadius: 'md',
            border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg',
          })}
          value={sourceFilter()}
          onChange={(e) => setSourceFilter(e.currentTarget.value)}
        >
          <option value="">All sources</option>
          <option value="morfeusz">morfeusz</option>
          <option value="manual">manual</option>
        </select>
      </div>

      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={lemmas()}>
            {() => (
              <Show
                when={filtered().length > 0}
                fallback={<EmptyState heading="No lemmas found" description={search() || posFilter() || sourceFilter() ? 'Try adjusting your filters.' : 'Add your first lemma to get started.'} action={!search() && !posFilter() && !sourceFilter() ? { label: 'Add lemma', onClick: () => setShowAddForm(true) } : undefined} />}
              >
                <table class={css({ w: 'full', borderCollapse: 'collapse' })}>
                  <thead>
                    <tr class={css({ borderBottom: '2px solid', borderColor: 'border' })}>
                      <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Lemma</th>
                      <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>POS</th>
                      <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Source</th>
                      <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Created</th>
                      <th class={css({ p: '3', w: '1' })} />
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filtered()}>
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
                          <td class={css({ p: '3' })}>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteId(lemma.id)}>Delete</Button>
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
      </ErrorBoundary>

      <ConfirmDialog
        open={deleteId() !== null}
        title="Delete lemma"
        description="This will delete the lemma and all its morphological forms and learning targets."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        loading={deleting()}
      />
    </div>
  )
}
