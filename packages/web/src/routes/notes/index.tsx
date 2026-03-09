import { createResource, createSignal, createMemo, For, Show, Suspense, ErrorBoundary } from 'solid-js'
import type { NoteListItem } from '../../api/types'
import { A } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import * as Table from '../../components/ui/table'
import { CreateNoteDialog } from '../../components/CreateNoteDialog'

const KIND_OPTIONS = ['', 'morph', 'basic', 'gloss', 'cloze', 'choice', 'error', 'classifier'] as const

const STATUS_OPTIONS = ['', 'draft', 'approved', 'flagged', 'rejected'] as const

const KIND_STYLE: Record<string, { bg: string; color: string }> = {
  morph:      { bg: 'blue.3',   color: 'blue.11'   },
  basic:      { bg: 'green.3',  color: 'green.11'  },
  gloss:      { bg: 'purple.3', color: 'purple.11' },
  cloze:      { bg: 'teal.3',   color: 'teal.11'   },
  choice:     { bg: 'violet.3', color: 'violet.11' },
  error:      { bg: 'red.3',    color: 'red.11'    },
  classifier: { bg: 'orange.3', color: 'orange.11' },
}

function KindBadge(props: { kind: string }) {
  const style = () => KIND_STYLE[props.kind] ?? { bg: 'gray.3', color: 'gray.11' }
  return (
    <span class={css({
      display: 'inline-block',
      px: '2',
      py: '0.5',
      borderRadius: 'l2',
      fontSize: 'xs',
      fontWeight: 'medium',
      bg: style().bg,
      color: style().color,
    })}>
      {props.kind}
    </span>
  )
}

export default function NotesIndex() {
  const [notes, { refetch }] = createResource<NoteListItem[]>(() => api.notes.list({}))
  const [kindFilter, setKindFilter] = createSignal('')
  const [statusFilter, setStatusFilter] = createSignal('')
  const [deleteId, setDeleteId] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  const [showCreate, setShowCreate] = createSignal(false)

  const filtered = createMemo(() => {
    const data = notes()
    if (!data) return []
    const k = kindFilter()
    const s = statusFilter()
    let result = data
    if (k) result = result.filter((n) => n.kind === k)
    if (s) result = result.filter((n) => n.status === s)
    return result
  })

  const handleDelete = async () => {
    const id = deleteId()
    if (!id) return
    setDeleting(true)
    try {
      await api.notes.delete({ id })
      setDeleteId(null)
      refetch()
    } finally {
      setDeleting(false)
    }
  }

  const selectStyle = css({
    px: '3', py: '2', fontSize: 'sm', borderRadius: 'l2',
    border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg.default',
  })

  function notePreview(note: NoteListItem): string {
    const truncate = (s: string) => s.length > 60 ? s.slice(0, 60) + '…' : s
    if (note.kind === 'morph') return note.lemmaText ? truncate(note.lemmaText) : '—'
    if (note.kind === 'gloss') {
      const parts = [note.lemmaText, note.back].filter(Boolean)
      return parts.length > 0 ? truncate(parts.join(' → ')) : '—'
    }
    if (note.kind === 'basic') return note.front ? truncate(note.front) : '—'
    // Contextual kinds: use sentence text if available
    if (note.sentenceText) return truncate(note.sentenceText)
    // Fallback for contextual kinds without sentence text
    if (note.front) return truncate(note.front)
    return '—'
  }

  return (
    <div class={css({ py: '4' })}>
      <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '6' })}>
        <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>Notes</h1>
        <Button variant="solid" onClick={() => setShowCreate(true)}>
          New basic note
        </Button>
      </div>

      <div class={css({ display: 'flex', gap: '3', mb: '4', flexWrap: 'wrap' })}>
        <select class={selectStyle} value={kindFilter()} onChange={(e) => setKindFilter(e.currentTarget.value)}>
          <For each={[...KIND_OPTIONS]}>
            {(k) => <option value={k}>{k || 'All kinds'}</option>}
          </For>
        </select>
        <select class={selectStyle} value={statusFilter()} onChange={(e) => setStatusFilter(e.currentTarget.value)}>
          <For each={[...STATUS_OPTIONS]}>
            {(s) => <option value={s}>{s || 'All statuses'}</option>}
          </For>
        </select>
      </div>

      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={notes()}>
              <Show
                when={filtered().length > 0}
                fallback={
                  <EmptyState
                    heading="No notes found"
                    description={kindFilter() || statusFilter() ? 'Try a different filter.' : 'Create your first basic note to get started.'}
                    {...(!kindFilter() && !statusFilter() ? { action: { label: 'New basic note', onClick: () => setShowCreate(true) } } : {})}
                  />
                }
              >
                <Table.Root>
                  <Table.Head>
                    <Table.Row>
                      <Table.Header>Kind</Table.Header>
                      <Table.Header>Preview</Table.Header>
                      <Table.Header>Created</Table.Header>
                      <Table.Header class={css({ w: '1' })} />
                    </Table.Row>
                  </Table.Head>
                  <Table.Body>
                    <For each={filtered()}>
                      {(note) => (
                        <Table.Row>
                          <Table.Cell>
                            <KindBadge kind={note.kind} />
                          </Table.Cell>
                          <Table.Cell>
                            <A href={`/notes/${note.id}`} class={css({ color: 'blue.9', textDecoration: 'none', fontWeight: 'medium', _hover: { textDecoration: 'underline' } })}>
                              {notePreview(note)}
                            </A>
                          </Table.Cell>
                          <Table.Cell class={css({ color: 'fg.muted', fontSize: 'sm', whiteSpace: 'nowrap' })}>
                            {new Date(note.createdAt).toLocaleDateString()}
                          </Table.Cell>
                          <Table.Cell>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteId(note.id)}>Delete</Button>
                          </Table.Cell>
                        </Table.Row>
                      )}
                    </For>
                  </Table.Body>
                </Table.Root>
              </Show>
          </Show>
        </Suspense>
      </ErrorBoundary>

      <ConfirmDialog
        open={deleteId() !== null}
        title="Delete note"
        description="This will delete the note and all its cards. Review history for those cards will also be removed."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        loading={deleting()}
      />

      <CreateNoteDialog
        open={showCreate()}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); refetch() }}
      />
    </div>
  )
}
