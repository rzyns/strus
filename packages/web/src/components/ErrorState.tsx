import { Show } from 'solid-js'
import { css } from '../../styled-system/css'
import { Button } from './Button'

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState(props: ErrorStateProps) {
  return (
    <div class={css({ textAlign: 'center', py: '12', px: '4' })}>
      <p class={css({ color: 'danger', fontWeight: 'medium', mb: '2' })}>
        Something went wrong
      </p>
      <p class={css({ color: 'fg.muted', fontSize: 'sm', mb: '4' })}>{props.message}</p>
      <Show when={props.onRetry}>
        {(retry) => (
          <Button variant="outline" onClick={retry()}>
            Retry
          </Button>
        )}
      </Show>
    </div>
  )
}
