import type { ParentProps } from 'solid-js'
import { Show } from 'solid-js'
import { css } from '../../styled-system/css'

interface CardProps extends ParentProps {
  title?: string
  class?: string
}

export function Card(props: CardProps) {
  return (
    <div class={`${css({
      bg: 'bg.subtle',
      border: '1px solid',
      borderColor: 'border',
      borderRadius: 'lg',
      shadow: 'md',
      p: '4',
    })} ${props.class ?? ''}`}>
      <Show when={props.title}>
        <h3 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '3' })}>{props.title}</h3>
      </Show>
      {props.children}
    </div>
  )
}
