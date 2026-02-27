import { createResource, createSignal, Show, Suspense, ErrorBoundary, Switch, Match } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { NounTable } from '../../components/paradigm/NounTable'
import { VerbTable } from '../../components/paradigm/VerbTable'
import { AdjTable } from '../../components/paradigm/AdjTable'
import { FlatFormTable } from '../../components/paradigm/FlatFormTable'

export default function LemmaDetail() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [lemma, { refetch: refetchLemma }] = createResource(() => api.lemmas.get({ id: params.id }))
  const [forms, { refetch: refetchForms }] = createResource(() => api.lemmas.forms({ id: params.id }))

  const [showDelete, setShowDelete] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.lemmas.delete({ id: params.id })
      navigate('/lemmas')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div class={css({ py: '4' })}>
      <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={() => { refetchLemma(); refetchForms() }} />}>
        <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>}>
          <Show when={lemma()}>
            {(data) => (
              <>
                <div class={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: '6' })}>
                  <div>
                    <h1 class={css({ fontSize: '3xl', fontWeight: 'bold', fontFamily: 'monospace', mb: '2' })}>
                      {data().lemma}
                    </h1>
                    <div class={css({ display: 'flex', gap: '2', mb: '2', flexWrap: 'wrap' })}>
                      <Badge variant="pos" value={data().pos} />
                      <Badge variant="source" value={data().source} />
                    </div>
                    <Show when={data().notes}>
                      <p class={css({ color: 'fg.muted', mb: '2', fontSize: 'sm' })}>{data().notes}</p>
                    </Show>
                    <p class={css({ color: 'fg.subtle', fontSize: 'xs' })}>
                      Added {new Date(data().createdAt).toLocaleDateString()}
                      {' \u00B7 '}
                      Updated {new Date(data().updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button variant="danger" onClick={() => setShowDelete(true)}>Delete</Button>
                </div>

                <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '4' })}>Paradigm</h2>

                <Suspense fallback={<Spinner />}>
                  <Show when={forms()}>
                    {(fs) => (
                      <Show
                        when={fs().length > 0}
                        fallback={
                          <EmptyState
                            heading="No forms"
                            description={data().source === 'manual' ? 'This lemma uses manual source \u2014 forms must be added manually.' : 'No morphological forms were generated.'}
                          />
                        }
                      >
                        <Switch fallback={<FlatFormTable forms={fs()} />}>
                          <Match when={data().pos === 'subst'}><NounTable forms={fs()} /></Match>
                          <Match when={data().pos === 'verb'}><VerbTable forms={fs()} /></Match>
                          <Match when={data().pos === 'adj'}><AdjTable forms={fs()} /></Match>
                        </Switch>
                      </Show>
                    )}
                  </Show>
                </Suspense>

                <ConfirmDialog
                  open={showDelete()}
                  title="Delete lemma"
                  description={`Delete "${data().lemma}"? This will also delete all morphological forms and learning targets.`}
                  confirmLabel="Delete"
                  onConfirm={handleDelete}
                  onCancel={() => setShowDelete(false)}
                  loading={deleting()}
                />
              </>
            )}
          </Show>
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
