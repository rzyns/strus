import type { ParentProps } from 'solid-js'
import { Show } from 'solid-js'
import * as ParkCard from './ui/card'

interface CardProps extends ParentProps {
  title?: string
  class?: string
}

export function Card(props: CardProps) {
  return (
    <ParkCard.Root class={props.class}>
      <Show when={props.title}>
        <ParkCard.Header>
          <ParkCard.Title>{props.title}</ParkCard.Title>
        </ParkCard.Header>
      </Show>
      <ParkCard.Body>
        {props.children}
      </ParkCard.Body>
    </ParkCard.Root>
  )
}
