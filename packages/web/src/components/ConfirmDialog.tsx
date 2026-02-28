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
  return (
    <DialogRoot
      open={props.open}
      onOpenChange={(details) => { if (!details.open) props.onCancel() }}
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
            maxW: '400px',
            w: 'full',
            border: '1px solid',
            borderColor: 'border',
          })}
        >
          <DialogTitle class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '2' })}>
            {props.title}
          </DialogTitle>
          <DialogDescription class={css({ color: 'fg.muted', fontSize: 'sm', mb: '6' })}>
            {props.description ?? 'This action cannot be undone.'}
          </DialogDescription>
          <div class={css({ display: 'flex', justifyContent: 'flex-end', gap: '3' })}>
            <Button variant="ghost" onClick={props.onCancel} disabled={props.loading}>
              Cancel
            </Button>
            <Button variant="danger" onClick={props.onConfirm} loading={props.loading}>
              {props.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </DialogPositioner>
    </DialogRoot>
  )
}
