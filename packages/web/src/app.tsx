import { Router, Route } from '@solidjs/router'
import { Suspense, lazy } from 'solid-js'
import { Nav } from './components/Nav'
import { css } from '../styled-system/css'

const Home = lazy(() => import('./routes/home'))
const ListsIndex = lazy(() => import('./routes/lists/index'))
const ListDetail = lazy(() => import('./routes/lists/[id]'))
const LemmasIndex = lazy(() => import('./routes/lemmas/index'))
const LemmaDetail = lazy(() => import('./routes/lemmas/[id]'))
const Import = lazy(() => import('./routes/import'))
const Quiz = lazy(() => import('./routes/quiz/index'))
const NotFound = lazy(() => import('./routes/not-found'))

export function App() {
  return (
    <Router
      root={(props) => (
        <>
          <Nav />
          <main class={css({ maxW: '1200px', mx: 'auto', px: '4', py: '6' })}>
            <Suspense fallback={<div class={css({ color: 'fg.muted' })}>Loading…</div>}>
              {props.children}
            </Suspense>
          </main>
        </>
      )}
    >
      <Route path="/" component={Home} />
      <Route path="/lists" component={ListsIndex} />
      <Route path="/lists/:id" component={ListDetail} />
      <Route path="/lemmas" component={LemmasIndex} />
      <Route path="/lemmas/:id" component={LemmaDetail} />
      <Route path="/import" component={Import} />
      <Route path="/quiz" component={Quiz} />
      <Route path="*" component={NotFound} />
    </Router>
  )
}
