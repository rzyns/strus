import { A } from '@solidjs/router'
import { css } from '../../styled-system/css'

export default function NotFound() {
  return <div class={css({ py: '8', textAlign: 'center' })}>
    <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '2' })}>404</h1>
    <p class={css({ color: 'fg.muted', mb: '4' })}>Page not found.</p>
    <A href="/" class={css({ color: 'primary', textDecoration: 'underline' })}>
      Go home
    </A>
  </div>
}
