import { badge } from '../../styled-system/recipes'

type BadgeColorVariant = 'default' | 'blue' | 'green' | 'purple' | 'teal' | 'amber' | 'red' | 'slate'

const POS_COLORS: Record<string, BadgeColorVariant> = {
  subst: 'blue',
  verb: 'green',
  adj: 'purple',
  adv: 'teal',
}

const SOURCE_COLORS: Record<string, BadgeColorVariant> = {
  morfeusz: 'blue',
  manual: 'amber',
}

const STATE_COLORS: Record<number, BadgeColorVariant> = {
  0: 'slate',
  1: 'amber',
  2: 'green',
  3: 'red',
}

interface BadgeProps {
  variant?: 'default' | 'pos' | 'source' | 'state'
  value: string
  class?: string
}

export function Badge(props: BadgeProps) {
  const color = (): BadgeColorVariant => {
    switch (props.variant) {
      case 'pos':
        return POS_COLORS[props.value] ?? 'default'
      case 'source':
        return SOURCE_COLORS[props.value] ?? 'default'
      case 'state':
        return STATE_COLORS[Number(props.value)] ?? 'default'
      default:
        return 'default'
    }
  }

  return (
    <span class={`${badge({ variant: color() })} ${props.class ?? ''}`}>
      {props.value}
    </span>
  )
}
