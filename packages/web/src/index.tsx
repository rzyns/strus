// Restore theme before first render to avoid flash
const saved = localStorage.getItem('theme') ?? 'light'
if (saved === 'dark') {
  document.documentElement.classList.add('dark')
}

// OTel must be initialized before any fetch() calls are made so the
// instrumentation can patch window.fetch before the app renders.
import { initTelemetry } from './telemetry'
initTelemetry()

import { render } from 'solid-js/web'
import { App } from './app'
import './index.css'

render(() => <App />, document.getElementById('root')!)
