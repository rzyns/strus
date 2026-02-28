import { Spinner as ParkSpinner } from './ui/spinner'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  class?: string
}

export function Spinner(props: SpinnerProps) {
  return <ParkSpinner size={props.size ?? 'md'} class={props.class} />
}
