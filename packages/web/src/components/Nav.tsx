import { A } from '@solidjs/router'
import { createResource, createSignal } from 'solid-js'
import { css } from '../../styled-system/css'
import { api } from '../api/client'

const linkStyle = css({ color: 'fg.muted', textDecoration: 'none', fontSize: 'sm', _hover: { color: 'fg.default' } })
const activeLinkStyle = css({ color: 'fg.default', fontWeight: 'medium' })

export function Nav() {
  const [theme, setTheme] = createSignal(
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )

  // Fetch draft count once on mount — acceptable staleness for a nav badge
  const [stats] = createResource(() => api.stats.overview({}))
  const draftCount = () => (stats()?.draftCount ?? 0)

  const toggleTheme = () => {
    const next = theme() === 'light' ? 'dark' : 'light'
    if (next === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  return (
    <nav class={css({
      position: 'sticky',
      top: 0,
      zIndex: 'sticky',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      px: '4',
      py: '3',
      borderBottom: '1px solid',
      borderColor: 'border',
      bg: 'bg/80',
      backdropFilter: 'blur(8px)',
    })}>
      <A href="/" class={css({ fontWeight: 'bold', fontSize: 'lg', textDecoration: 'none', color: 'fg.default' })}>
        strus
      </A>
      <div class={css({ display: 'flex', gap: '4', alignItems: 'center' })}>
        <A href="/" end activeClass={activeLinkStyle} class={linkStyle}>Dashboard</A>
        <A href="/lists" activeClass={activeLinkStyle} class={linkStyle}>Lists</A>
        <A href="/lemmas" activeClass={activeLinkStyle} class={linkStyle}>Lemmas</A>
        <A href="/notes" activeClass={activeLinkStyle} class={linkStyle}>Notes</A>
        <A href="/review" activeClass={activeLinkStyle} class={linkStyle}>
          Review{draftCount() > 0 ? ` (${draftCount()})` : ''}
        </A>
        <A href="/import" activeClass={activeLinkStyle} class={linkStyle}>Import</A>
        <A href="/quiz" activeClass={activeLinkStyle} class={linkStyle}>Quiz</A>
        <A href="/settings" activeClass={activeLinkStyle} class={linkStyle}>Settings</A>
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
