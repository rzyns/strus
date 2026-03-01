import { createResource, createSignal, For, Show } from 'solid-js'
import {
  DialogRoot,
  DialogBackdrop,
  DialogPositioner,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@ark-ui/solid/dialog'
import { css } from '../../styled-system/css'
import { Button } from './Button'
import { api } from '../api/client'

interface CreateNoteDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (noteId: string) => void
}

export function CreateNoteDialog(props: CreateNoteDialogProps) {
  const [front, setFront] = createSignal('')
  const [back, setBack] = createSignal('')
  const [listId, setListId] = createSignal('')
  const [creating, setCreating] = createSignal(false)

  const [lists] = createResource(() => api.lists.list({}))

  const handleSubmit = async () => {
    const f = front().trim()
    const b = back().trim()
    if (!f || !b) return

    setCreating(true)
    try {
      const note = await api.notes.create({
        front: f,
        back: b,
        ...(listId() ? { listId: listId() } : {}),
      })
      setFront('')
      setBack('')
      setListId('')
      props.onCreated(note.id)
    } finally {
      setCreating(false)
    }
  }

  const handleCancel = () => {
    setFront('')
    setBack('')
    setListId('')
    props.onClose()
  }

  const inputStyle = css({
    display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
    borderRadius: 'l2', border: '1px solid', borderColor: 'border',
    bg: 'bg', color: 'fg.default', outline: 'none', minH: '80px',
    fontFamily: 'inherit', resize: 'vertical',
    _focus: { borderColor: 'blue.8', boxShadow: '0 0 0 1px {colors.blue.8}' },
  })

  const selectStyle = css({
    display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
    borderRadius: 'l2', border: '1px solid', borderColor: 'border',
    bg: 'bg', color: 'fg.default',
  })

  return (
    <DialogRoot
      open={props.open}
      onOpenChange={(details) => { if (!details.open) handleCancel() }}
      lazyMount
      unmountOnExit
    >
      <DialogBackdrop
        class={css({
          position: 'fixed',
          inset: 0,
          zIndex: 'overlay',
          bg: 'black/60',
          _open: { animation: 'fadeIn 0.15s ease' },
          _closed: { animation: 'fadeOut 0.1s ease' },
        })}
      />
      <DialogPositioner
        class={css({
          position: 'fixed',
          inset: 0,
          zIndex: 'modal',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: '4',
        })}
      >
        <DialogContent
          class={css({
            bg: 'bg',
            borderRadius: 'lg',
            shadow: 'lg',
            p: '6',
            maxW: '500px',
            w: 'full',
            border: '1px solid',
            borderColor: 'border',
          })}
        >
          <DialogTitle class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '2' })}>
            New basic note
          </DialogTitle>
          <DialogDescription class={css({ color: 'fg.muted', fontSize: 'sm', mb: '4' })}>
            Create a custom flashcard with front and back text.
          </DialogDescription>

          <div class={css({ mb: '3' })}>
            <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>
              Front
            </label>
            <textarea
              class={inputStyle}
              value={front()}
              onInput={(e) => setFront(e.currentTarget.value)}
              placeholder="Question or prompt"
            />
          </div>

          <div class={css({ mb: '3' })}>
            <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>
              Back
            </label>
            <textarea
              class={inputStyle}
              value={back()}
              onInput={(e) => setBack(e.currentTarget.value)}
              placeholder="Answer"
            />
          </div>

          <div class={css({ mb: '4' })}>
            <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })}>
              List (optional)
            </label>
            <select
              class={selectStyle}
              value={listId()}
              onChange={(e) => setListId(e.currentTarget.value)}
            >
              <option value="">No list</option>
              <Show when={lists()}>
                {(data) => (
                  <For each={data()}>
                    {(list: any) => <option value={list.id}>{list.name}</option>}
                  </For>
                )}
              </Show>
            </select>
          </div>

          <div class={css({ display: 'flex', justifyContent: 'flex-end', gap: '3' })}>
            <Button variant="ghost" onClick={handleCancel} disabled={creating()}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={creating()} disabled={!front().trim() || !back().trim()}>
              Create
            </Button>
          </div>
        </DialogContent>
      </DialogPositioner>
    </DialogRoot>
  )
}
