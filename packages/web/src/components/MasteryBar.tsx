import { css } from '../../styled-system/css'

interface MasteryBarProps {
  labelPl: string | null
  label: string
  masteredPct: number
  totalCards?: number
}

function masteryColor(pct: number): string {
  if (pct >= 80) return 'green.9'
  if (pct >= 40) return 'yellow.9'
  return 'red.9'
}

function masteryBgColor(pct: number): string {
  if (pct >= 80) return 'green.3'
  if (pct >= 40) return 'yellow.3'
  return 'red.3'
}

function masteryEmoji(pct: number): string {
  if (pct >= 80) return '🟢'
  if (pct >= 40) return '🟡'
  return '🔴'
}

export function MasteryBar(props: MasteryBarProps) {
  const pct = () => Math.min(100, Math.max(0, props.masteredPct))

  return (
    <div class={css({ display: 'flex', alignItems: 'center', gap: '3', py: '1.5' })}>
      <div class={css({ minWidth: '28', flexShrink: 0 })}>
        <span class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.default' })}>
          {props.labelPl ?? props.label}
        </span>
        {props.labelPl && (
          <span class={css({ fontSize: 'xs', color: 'fg.muted', ml: '1' })}>
            ({props.label})
          </span>
        )}
      </div>
      <div class={css({ flex: 1, position: 'relative', height: '2', bg: 'bg.subtle', borderRadius: 'full', overflow: 'hidden' })}>
        <div
          class={css({ position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 'full', transition: 'width 0.3s ease' })}
          style={{
            width: `${pct()}%`,
            'background-color': `var(--colors-${masteryColor(props.masteredPct).replace('.', '-')})`,
          }}
        />
      </div>
      <div class={css({ minWidth: '12', textAlign: 'right', flexShrink: 0 })}>
        <span
          class={css({ fontSize: 'sm', fontWeight: 'semibold' })}
          style={{ color: `var(--colors-${masteryColor(props.masteredPct).replace('.', '-')})` }}
        >
          {props.masteredPct}%
        </span>
      </div>
      {props.totalCards !== undefined && (
        <div class={css({ minWidth: '16', textAlign: 'right', flexShrink: 0 })}>
          <span class={css({ fontSize: 'xs', color: 'fg.muted' })}>{props.totalCards} cards</span>
        </div>
      )}
    </div>
  )
}

export function MasteryBadge(props: { masteredPct: number; label: string; labelPl?: string | null }) {
  return (
    <span
      class={css({ fontSize: 'xs', px: '2', py: '0.5', borderRadius: 'full', fontWeight: 'medium', display: 'inline-flex', alignItems: 'center', gap: '1' })}
      style={{
        'background-color': `var(--colors-${masteryBgColor(props.masteredPct).replace('.', '-')})`,
        color: `var(--colors-${masteryColor(props.masteredPct).replace('.', '-')})`,
      }}
    >
      <span>{masteryEmoji(props.masteredPct)}</span>
      <span>{props.labelPl ?? props.label}</span>
    </span>
  )
}
