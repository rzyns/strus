import { createResource, createSignal, For, Show, Suspense, ErrorBoundary } from 'solid-js'
import { A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'

export default function ListsIndex() {
  const [lists, { refetch }] = createResource(() => api.lists.list({}))
  const [showForm, setShowForm] = createSignal(false)
  const [name, setName] = createSignal('')
  const [description, setDescription] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [deleteId, setDeleteId] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)

  const handleCreate = async () => {
    const n = name().trim()
    if (!n) return
    setCreating(true)
    try {
      await api.lists.create({ name: n, description: description().trim() || undefined })
      setName('')
      setDescription('')
      setShowForm(false)
      refetch()
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    const id = deleteId()
    if (!id) return
    setDeleting(true)
    try {
      await api.lists.delete({ id })
      setDeleteId(null)
      refetch()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div class={css({ py: '4' })}>
      <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '6' })}>
        <h1 class={css({ fontSize: '2xl', fontWeight: 'bold' })}>Vocabulary Lists</h1>
        <Button variant={showForm() ? 'ghost' : 'solid'} onClick={() => setShowForm(!showForm())}>
          {showForm() ? 'Cancel' : 'New list'}
        </Button>
      </div>

      <Show when={showForm()}>
        <div class={css({ mb: '6', p: '4', border: '1px solid', borderColor: 'border', borderRadius: 'lg', bg: 'bg.subtle' })}>
          <div class={css({ mb: '3' })}>
            <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1' })}>Name</label>
            <input
              class={css({
                display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
                borderRadius: 'md', border: '1px solid', borderColor: 'border',
                bg: 'bg', color: 'fg', outline: 'none',
                _focus: { borderColor: 'primary' },
              })}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="List name"
            />
          </div>
          <div class={css({ mb: '3' })}>
            <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1' })}>Description</label>
            <input
              class={css({
                display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
                borderRadius: 'md', border: '1px solid', borderColor: 'border',
                bg: 'bg', color: 'fg', outline: 'none',
                _focus: { borderColor: 'primary' },
              })}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              placeholder="Optional description"
            />
          </div>
          <Button onClick={handleCreate} loading={creating()} disabled={!name().trim()}>
            Create list
          </Button>
        </div>
      </Show>

      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={lists()}>
            {(data) => (
              <Show
                when={data().length > 0}
                fallback={<EmptyState heading="No lists yet" description="Create a vocabulary list to organize your lemmas." action={{ label: 'New list', onClick: () => setShowForm(true) }} />}
              >
                <table class={css({ w: 'full', borderCollapse: 'collapse' })}>
                  <thead>
                    <tr class={css({ borderBottom: '2px solid', borderColor: 'border' })}>
                      <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Name</th>
                      <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Description</th>
                      <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Created</th>
                      <th class={css({ p: '3', w: '1' })} />
                    </tr>
                  </thead>
                  <tbody>
                    <For each={data()}>
                      {(list) => (
                        <tr class={css({ borderBottom: '1px solid', borderColor: 'border', _hover: { bg: 'bg.subtle' } })}>
                          <td class={css({ p: '3' })}>
                            <A href={`/lists/${list.id}`} class={css({ color: 'primary', textDecoration: 'none', fontWeight: 'medium', _hover: { textDecoration: 'underline' } })}>
                              {list.name}
                            </A>
                          </td>
                          <td class={css({ p: '3', color: 'fg.muted', fontSize: 'sm', maxW: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
                            {list.description ?? '\u2014'}
                          </td>
                          <td class={css({ p: '3', color: 'fg.muted', fontSize: 'sm', whiteSpace: 'nowrap' })}>
                            {new Date(list.createdAt).toLocaleDateString()}
                          </td>
                          <td class={css({ p: '3' })}>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteId(list.id)}>Delete</Button>
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
        title="Delete list"
        description="This will remove the list and its lemma associations. Lemmas themselves are not deleted."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        loading={deleting()}
      />
    </div>
  )
}
