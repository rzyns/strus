import { createResource, createSignal, Suspense, ErrorBoundary, Show } from 'solid-js'
import { A, useNavigate } from '@solidjs/router'
import { css } from '../../styled-system/css'
import { api } from '../api/client'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { CreateNoteDialog } from '../components/CreateNoteDialog'

function dueBadgeColor(count: number): string {
  if (count === 0) return 'green.9'
  if (count < 10) return 'yellow.9'
  return 'red.9'
}

function DashboardContent(props: { onNewNote: () => void }) {
  const [stats, { refetch }] = createResource(() => api.stats.overview({}))
  const navigate = useNavigate()

  return (
    <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
      <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
        <Show when={stats()}>
          {(data) => (
            <>
              <Show when={(data().draftCount ?? 0) > 0}>
                <div class={css({
                  mb: '6',
                  p: '4',
                  bg: 'amber.2',
                  border: '1px solid',
                  borderColor: 'amber.6',
                  borderRadius: 'l3',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                })}>
                  <div>
                    <p class={css({ fontWeight: 'semibold', color: 'amber.11', fontSize: 'sm' })}>
                      ⏳ Review queue
                    </p>
                    <p class={css({ color: 'amber.10', fontSize: 'sm', mt: '0.5' })}>
                      {data().draftCount} exercise{data().draftCount === 1 ? '' : 's'} waiting for review
                    </p>
                  </div>
                  <A
                    href="/review"
                    class={css({
                      fontSize: 'sm',
                      fontWeight: 'medium',
                      color: 'amber.11',
                      textDecoration: 'none',
                      _hover: { textDecoration: 'underline' },
                    })}
                  >
                    Review now →
                  </A>
                </div>
              </Show>

              <div class={css({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4', mb: '8' })}>
                <div class={css({
                  bg: 'bg',
                  border: '1px solid',
                  borderColor: 'border',
                  borderRadius: 'l3',
                  p: '5',
                  shadow: 'sm',
                  borderLeft: '4px solid',
                  borderLeftColor: 'blue.9',
                })}>
                  <p class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.muted', mb: '1' })}>Lemmas</p>
                  <p class={css({ fontSize: '3xl', fontWeight: 'bold', color: 'fg.default' })}>{data().lemmaCount}</p>
                </div>
                <div class={css({
                  bg: 'bg',
                  border: '1px solid',
                  borderColor: 'border',
                  borderRadius: 'l3',
                  p: '5',
                  shadow: 'sm',
                  borderLeft: '4px solid',
                  borderLeftColor: 'green.9',
                })}>
                  <p class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.muted', mb: '1' })}>Lists</p>
                  <p class={css({ fontSize: '3xl', fontWeight: 'bold', color: 'fg.default' })}>{data().listCount}</p>
                </div>
                <div class={css({
                  bg: 'bg',
                  border: '1px solid',
                  borderColor: 'border',
                  borderRadius: 'l3',
                  p: '5',
                  shadow: 'sm',
                  borderLeft: '4px solid',
                  borderLeftColor: dueBadgeColor(data().dueCount),
                })}>
                  <p class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'fg.muted', mb: '1' })}>Due</p>
                  <p class={css({ fontSize: '3xl', fontWeight: 'bold', color: dueBadgeColor(data().dueCount) })}>
                    {data().dueCount}
                  </p>
                </div>
              </div>

              <Card title="Quick actions">
                <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
                  <Button variant="outline" onClick={() => navigate('/lemmas')}>Browse lemmas</Button>
                  <Button variant="outline" onClick={() => navigate('/lists')}>View lists</Button>
                  <Button variant="outline" onClick={() => navigate('/notes')}>Notes</Button>
                  <Button variant="solid" onClick={props.onNewNote}>New basic note</Button>
                  <Button variant="solid" onClick={() => navigate('/import')}>Import text</Button>
                  <Button variant="solid" onClick={() => navigate('/quiz')}>Start quiz</Button>
                </div>
              </Card>
            </>
          )}
        </Show>
      </Suspense>
    </ErrorBoundary>
  )
}

export default function Home() {
  const [showCreate, setShowCreate] = createSignal(false)
  const navigate = useNavigate()

  return (
    <div class={css({ py: '4' })}>
      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '6', color: 'fg.default' })}>Dashboard</h1>
      <DashboardContent onNewNote={() => setShowCreate(true)} />
      <CreateNoteDialog
        open={showCreate()}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); navigate(`/notes/${id}`) }}
      />
    </div>
  )
}
