import { createSignal, Show } from 'solid-js'
import { css } from '../../styled-system/css'

interface JsonViewerProps {
  data: unknown
  label?: string
}

export function JsonViewer(props: JsonViewerProps) {
  const [open, setOpen] = createSignal(false)

  return (
    <div class={css({ display: 'inline-block', position: 'relative' })}>
      <button
        onClick={() => setOpen(!open())}
        title={open() ? 'Hide raw JSON' : 'Show raw JSON'}
        class={css({
          display: 'inline-flex',
          alignItems: 'center',
          gap: '1',
          px: '2',
          py: '1',
          fontSize: 'xs',
          fontFamily: 'mono',
          fontWeight: 'medium',
          borderRadius: 'md',
          border: '1px solid',
          borderColor: 'border',
          bg: open() ? 'bg.muted' : 'bg',
          color: 'fg.muted',
          cursor: 'pointer',
          transition: 'all 0.1s ease',
          _hover: { color: 'fg.default', borderColor: 'border.strong', bg: 'bg.muted' },
        })}
      >
        <span>{open() ? '▾' : '▸'}</span>
        <span>{props.label ?? 'JSON'}</span>
      </button>

      <Show when={open()}>
        <div
          class={css({
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 'dropdown',
            minW: '320px',
            maxW: '560px',
            maxH: '480px',
            overflow: 'auto',
            bg: 'bg.subtle',
            border: '1px solid',
            borderColor: 'border',
            borderRadius: 'lg',
            shadow: 'lg',
            p: '3',
          })}
        >
          <pre
            class={css({
              fontSize: 'xs',
              fontFamily: 'mono',
              color: 'fg.default',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              m: 0,
            })}
          >
            {JSON.stringify(props.data, null, 2)}
          </pre>
        </div>
      </Show>
    </div>
  )
}
