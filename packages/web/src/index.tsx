// Restore theme before first render to avoid flash
const saved = localStorage.getItem('theme') ?? 'light'
document.documentElement.setAttribute('data-theme', saved)

import { render } from 'solid-js/web'
import { App } from './app'
import './index.css'

render(() => <App />, document.getElementById('root')!)
