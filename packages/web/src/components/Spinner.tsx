import { css, cx } from '../../styled-system/css'

const SIZES = { sm: '16px', md: '24px', lg: '40px' } as const

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  class?: string
}

export function Spinner(props: SpinnerProps) {
  const s = () => SIZES[props.size ?? 'md']

  return (
    <span
      role="status"
      class={cx(css({
        display: 'inline-block',
        borderRadius: 'full',
        border: '2px solid',
        borderColor: 'border',
        borderTopColor: 'primary',
        animation: 'spin 0.6s linear infinite',
      }), props.class)}
      style={{ width: s(), height: s() }}
    />
  )
}
