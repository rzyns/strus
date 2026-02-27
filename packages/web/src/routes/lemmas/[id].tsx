import { createResource, createMemo, For, Show, Suspense, ErrorBoundary } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { createSignal } from 'solid-js'

export default function LemmaDetail() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [lemma, { refetch: refetchLemma }] = createResource(() => api.lemmas.get({ id: params.id }))
  const [forms, { refetch: refetchForms }] = createResource(() => api.lemmas.forms({ id: params.id }))

  const [showDelete, setShowDelete] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)

  const sortedForms = createMemo(() => {
    const data = forms()
    if (!data) return []
    return [...data].sort((a, b) => a.tag.localeCompare(b.tag))
  })

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.lemmas.delete({ id: params.id })
      navigate('/lemmas')
    } finally {
      setDeleting(false)
    }
  }

  const parseParsedTag = (json: string): Record<string, string> => {
    try {
      return JSON.parse(json)
    } catch {
      return {}
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
                    {() => (
                      <Show
                        when={sortedForms().length > 0}
                        fallback={
                          <EmptyState
                            heading="No forms"
                            description={data().source === 'manual' ? 'This lemma uses manual source — forms must be added manually.' : 'No morphological forms were generated.'}
                          />
                        }
                      >
                        <table class={css({ w: 'full', borderCollapse: 'collapse' })}>
                          <thead>
                            <tr class={css({ borderBottom: '2px solid', borderColor: 'border' })}>
                              <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Form</th>
                              <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Tag</th>
                              <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Breakdown</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={sortedForms()}>
                              {(form) => (
                                <tr class={css({ borderBottom: '1px solid', borderColor: 'border', _hover: { bg: 'bg.subtle' } })}>
                                  <td class={css({ p: '3', fontFamily: 'monospace', fontWeight: 'medium' })}>
                                    {form.orth}
                                  </td>
                                  <td class={css({ p: '3' })}>
                                    <code class={css({ fontSize: 'xs', bg: 'bg.muted', px: '2', py: '0.5', borderRadius: 'sm' })}>
                                      {form.tag}
                                    </code>
                                  </td>
                                  <td class={css({ p: '3' })}>
                                    <div class={css({ display: 'flex', gap: '1', flexWrap: 'wrap' })}>
                                      <For each={Object.entries(parseParsedTag(form.parsedTag))}>
                                        {([key, value]) => (
                                          <Badge value={`${key}: ${value}`} />
                                        )}
                                      </For>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
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
