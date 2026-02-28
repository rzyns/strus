import type { JSX, ParentProps } from 'solid-js'
import { Button as ParkButton } from './ui/button'

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

const VARIANT_MAP = {
  solid: 'solid',
  outline: 'outline',
  ghost: 'plain',
  danger: 'solid',
} as const

export function Button(props: ButtonProps) {
  const parkVariant = () => VARIANT_MAP[props.variant ?? 'solid']

  return (
    <ParkButton
      type={props.type ?? 'button'}
      variant={parkVariant()}
      {...(props.size ? { size: props.size } : {})}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
      {...(props.loading !== undefined ? { loading: props.loading } : {})}
      {...(props.onClick ? { onClick: props.onClick } : {})}
      {...(props.class ? { class: props.class } : {})}
      {...(props.variant === 'danger' ? { colorPalette: 'red' } : {})}
    >
      {props.children}
    </ParkButton>
  )
}
