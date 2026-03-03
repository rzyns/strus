import { css } from '../../styled-system/css'

export const FSRS_STATE_LABELS: Record<number, string> = {
  0: 'New',
  1: 'Learning',
  2: 'Review',
  3: 'Relearning',
}

export function StateBadge(props: { state: number }) {
  const color = () => {
    switch (props.state) {
      case 0: return { bg: 'gray.3', fg: 'gray.11' }
      case 1: return { bg: 'amber.3', fg: 'amber.11' }
      case 2: return { bg: 'green.3', fg: 'green.11' }
      case 3: return { bg: 'red.3', fg: 'red.11' }
      default: return { bg: 'gray.3', fg: 'gray.11' }
    }
  }
  return (
    <span class={css({
      display: 'inline-block',
      px: '2',
      py: '0.5',
      borderRadius: 'l2',
      fontSize: 'xs',
      fontWeight: 'medium',
      bg: color().bg,
      color: color().fg,
    })}>
      {FSRS_STATE_LABELS[props.state] ?? `State ${props.state}`}
    </span>
  )
}

export function formatDue(iso: string): string {
  const due = new Date(iso)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`
  if (diffDays === -1) return 'yesterday'
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  return `in ${diffDays}d`
}
