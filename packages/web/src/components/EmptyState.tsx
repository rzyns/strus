import { Show } from 'solid-js'
import { css } from '../../styled-system/css'
import { Button } from './Button'

interface EmptyStateProps {
  heading: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class={css({ textAlign: 'center', py: '12', px: '4' })}>
      <h3 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '1' })}>{props.heading}</h3>
      <Show when={props.description}>
        <p class={css({ color: 'fg.muted', mb: '4' })}>{props.description}</p>
      </Show>
      <Show when={props.action}>
        {(action) => (
          <Button variant="outline" onClick={action().onClick}>
            {action().label}
          </Button>
        )}
      </Show>
    </div>
  )
}
