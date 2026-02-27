import type { JSX, ParentProps } from 'solid-js'
import { Show } from 'solid-js'
import { button } from '../../styled-system/recipes'
import { Spinner } from './Spinner'

type ButtonVariant = 'solid' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ParentProps {
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>
  class?: string
}

export function Button(props: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
      class={`${button({ variant: props.variant, size: props.size })} ${props.class ?? ''}`}
    >
      <Show when={props.loading}>
        <Spinner size="sm" />
      </Show>
      {props.children}
    </button>
  )
}
