// Restore theme before first render to avoid flash
const saved = localStorage.getItem('theme') ?? 'light'
if (saved === 'dark') {
  document.documentElement.classList.add('dark')
}

import { render } from 'solid-js/web'
import { App } from './app'
import './index.css'

render(() => <App />, document.getElementById('root')!)
