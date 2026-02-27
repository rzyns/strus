import { A } from '@solidjs/router'
import { css } from '../../styled-system/css'

export function Nav() {
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
        <A href="/" class={css({ color: 'fg.muted', textDecoration: 'none', _hover: { color: 'fg' } })}>
          Dashboard
        </A>
        <A href="/lists" class={css({ color: 'fg.muted', textDecoration: 'none', _hover: { color: 'fg' } })}>
          Lists
        </A>
        <A href="/lemmas" class={css({ color: 'fg.muted', textDecoration: 'none', _hover: { color: 'fg' } })}>
          Lemmas
        </A>
        <A href="/import" class={css({ color: 'fg.muted', textDecoration: 'none', _hover: { color: 'fg' } })}>
          Import
        </A>
      </div>
    </nav>
  )
}
