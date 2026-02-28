import { createSignal, Show, For } from 'solid-js'
import { css } from '../../styled-system/css'

// ── Tokenizer ────────────────────────────────────────────────────────────────

type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'ws'

interface Token {
  kind: TokenKind
  text: string
}

function tokenize(json: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < json.length) {
    // Whitespace (preserve newlines / indentation)
    if (/\s/.test(json[i])) {
      let t = ''
      while (i < json.length && /\s/.test(json[i])) t += json[i++]
      tokens.push({ kind: 'ws', text: t })
      continue
    }
    // String — could be a key or a value; we decide after
    if (json[i] === '"') {
      let t = '"'
      i++
      while (i < json.length) {
        if (json[i] === '\\') { t += json[i] + json[i + 1]; i += 2 }
        else if (json[i] === '"') { t += '"'; i++; break }
        else { t += json[i++] }
      }
      // Look ahead past whitespace for ':'
      let j = i
      while (j < json.length && /[ \t]/.test(json[j])) j++
      const isKey = json[j] === ':'
      tokens.push({ kind: isKey ? 'key' : 'string', text: t })
      continue
    }
    // Number
    if (/[-\d]/.test(json[i])) {
      let t = ''
      while (i < json.length && /[-\d.eE+]/.test(json[i])) t += json[i++]
      tokens.push({ kind: 'number', text: t })
      continue
    }
    // true / false / null
    if (json.startsWith('true', i))  { tokens.push({ kind: 'boolean', text: 'true' });  i += 4; continue }
    if (json.startsWith('false', i)) { tokens.push({ kind: 'boolean', text: 'false' }); i += 5; continue }
    if (json.startsWith('null', i))  { tokens.push({ kind: 'null',    text: 'null' });  i += 4; continue }
    // Punctuation: { } [ ] : ,
    tokens.push({ kind: 'punct', text: json[i++] })
  }
  return tokens
}

// ── Token colours (inline styles — avoids Panda CSS atomic class explosion) ──

const TOKEN_COLOR: Record<TokenKind, string> = {
  key:     'var(--colors-blue-11, #3b82f6)',
  string:  'var(--colors-green-11, #16a34a)',
  number:  'var(--colors-amber-11, #d97706)',
  boolean: 'var(--colors-purple-11, #9333ea)',
  null:    'var(--colors-red-11, #dc2626)',
  punct:   'var(--colors-fg-muted)',
  ws:      'inherit',
}

// ── Component ────────────────────────────────────────────────────────────────

interface JsonViewerProps {
  data: unknown
  label?: string
}

export function JsonViewer(props: JsonViewerProps) {
  const [open, setOpen] = createSignal(false)

  const tokens = () => {
    try {
      return tokenize(JSON.stringify(props.data, null, 2))
    } catch {
      return [{ kind: 'string' as TokenKind, text: String(props.data) }]
    }
  }

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
          borderColor: open() ? 'border.strong' : 'border',
          bg: open() ? 'bg.muted' : 'bg',
          color: 'fg.muted',
          cursor: 'pointer',
          transition: 'all 0.1s ease',
          _hover: { color: 'fg.default', borderColor: 'border.strong', bg: 'bg.muted' },
        })}
      >
        <span style={{ 'font-size': '10px', 'line-height': '1' }}>{open() ? '▾' : '▸'}</span>
        <span>{props.label ?? 'JSON'}</span>
      </button>

      <Show when={open()}>
        <div
          class={css({
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 'dropdown',
            // Width fits content, caps at 80vw, never wraps
            width: 'max-content',
            maxWidth: '80vw',
            maxH: '520px',
            overflow: 'auto',
            bg: 'bg.subtle',
            border: '1px solid',
            borderColor: 'border',
            borderRadius: 'lg',
            shadow: 'lg',
            p: '4',
          })}
        >
          <pre
            class={css({
              fontSize: 'xs',
              fontFamily: 'mono',
              lineHeight: '1.6',
              m: 0,
              // Never wrap — horizontal scroll instead
              whiteSpace: 'pre',
              overflowX: 'visible',
            })}
          >
            <For each={tokens()}>
              {(tok) => (
                <span style={{ color: TOKEN_COLOR[tok.kind] }}>{tok.text}</span>
              )}
            </For>
          </pre>
        </div>
      </Show>
    </div>
  )
}
