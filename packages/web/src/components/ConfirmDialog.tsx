import { createEffect, onCleanup } from 'solid-js'
import { css } from '../../styled-system/css'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  let dialogRef: HTMLDialogElement | undefined

  createEffect(() => {
    if (props.open) {
      dialogRef?.showModal()
    } else {
      dialogRef?.close()
    }
  })

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onCancel()
    }
  }

  createEffect(() => {
    if (props.open) {
      document.addEventListener('keydown', onKeyDown)
      onCleanup(() => document.removeEventListener('keydown', onKeyDown))
    }
  })

  return (
    <dialog
      ref={dialogRef}
      class={css({
        border: 'none',
        borderRadius: 'lg',
        p: '6',
        maxW: '400px',
        w: '90vw',
        bg: 'bg',
        color: 'fg',
        shadow: 'lg',
        _backdrop: {
          bg: 'rgba(0,0,0,0.4)',
        },
      })}
      onClick={(e) => { if (e.target === dialogRef) props.onCancel() }}
    >
      <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '2' })}>
        {props.title}
      </h2>
      <p class={css({ color: 'fg.muted', fontSize: 'sm', mb: '6' })}>
        {props.description ?? 'This action cannot be undone.'}
      </p>
      <div class={css({ display: 'flex', justifyContent: 'flex-end', gap: '3' })}>
        <Button variant="ghost" onClick={props.onCancel} disabled={props.loading}>
          Cancel
        </Button>
        <Button variant="danger" onClick={props.onConfirm} loading={props.loading}>
          {props.confirmLabel ?? 'Confirm'}
        </Button>
      </div>
    </dialog>
  )
}
