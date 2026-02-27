import { createResource, Suspense, ErrorBoundary, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { css } from '../../styled-system/css'
import { api } from '../api/client'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'

function dueBadgeColor(count: number): string {
  if (count === 0) return 'green.500'
  if (count < 10) return 'amber.500'
  return 'red.500'
}

function DashboardContent() {
  const [stats, { refetch }] = createResource(() => api.stats.overview({}))
  const navigate = useNavigate()

  return (
    <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
      <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
        <Show when={stats()}>
          {(data) => (
            <>
              <div class={css({ display: 'grid', gridTemplateColumns: '3', gap: '4', mb: '8' })}>
                <Card title="Lemmas">
                  <p class={css({ fontSize: '3xl', fontWeight: 'bold' })}>{data().lemmaCount}</p>
                </Card>
                <Card title="Lists">
                  <p class={css({ fontSize: '3xl', fontWeight: 'bold' })}>{data().listCount}</p>
                </Card>
                <Card title="Due">
                  <p class={css({ fontSize: '3xl', fontWeight: 'bold', color: dueBadgeColor(data().dueCount) })}>
                    {data().dueCount}
                  </p>
                </Card>
              </div>

              <Card title="Quick actions">
                <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
                  <Button variant="outline" onClick={() => navigate('/lemmas')}>Browse lemmas</Button>
                  <Button variant="outline" onClick={() => navigate('/lists')}>View lists</Button>
                  <Button variant="solid" onClick={() => navigate('/import')}>Import text</Button>
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
  return (
    <div class={css({ py: '4' })}>
      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '6' })}>Dashboard</h1>
      <DashboardContent />
    </div>
  )
}
