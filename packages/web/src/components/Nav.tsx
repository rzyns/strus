import { A } from '@solidjs/router'
import { createSignal } from 'solid-js'
import { css } from '../../styled-system/css'

const linkStyle = css({ color: 'fg.muted', textDecoration: 'none', fontSize: 'sm', _hover: { color: 'fg' } })
const activeLinkStyle = css({ color: 'fg', fontWeight: 'medium' })

export function Nav() {
  const [theme, setTheme] = createSignal(
    document.documentElement.getAttribute('data-theme') ?? 'light'
  )

  const toggleTheme = () => {
    const next = theme() === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  return (
    <nav class={css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      px: '4',
      py: '3',
      borderBottom: '1px solid',
      borderColor: 'border',
      bg: 'bg',
    })}>
      <A href="/" class={css({ fontWeight: 'bold', fontSize: 'lg', textDecoration: 'none', color: 'fg' })}>
        strus
      </A>
      <div class={css({ display: 'flex', gap: '4', alignItems: 'center' })}>
        <A href="/" end activeClass={activeLinkStyle} class={linkStyle}>Dashboard</A>
        <A href="/lists" activeClass={activeLinkStyle} class={linkStyle}>Lists</A>
        <A href="/lemmas" activeClass={activeLinkStyle} class={linkStyle}>Lemmas</A>
        <A href="/import" activeClass={activeLinkStyle} class={linkStyle}>Import</A>
        <button
          onClick={toggleTheme}
          class={css({
            bg: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'md',
            p: '1',
          })}
          aria-label="Toggle theme"
        >
          {theme() === 'light' ? '\u{263D}' : '\u{2600}'}
        </button>
      </div>
    </nav>
  )
}
