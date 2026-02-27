import { createResource, createSignal, For, Show, Switch, Match } from 'solid-js'
import { A, useSearchParams } from '@solidjs/router'
import { css } from '../../styled-system/css'
import { api } from '../api/client'
import { Button } from '../components/Button'
import { Badge } from '../components/Badge'
import { Card } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'

type Step = 'input' | 'preview' | 'result'

interface Candidate {
  lemma: string
  pos: string
  formsFound: string[]
  ambiguous: boolean
  alreadyExists: boolean
  isMultiWord: boolean
}

interface ImportResult {
  created: Array<{ lemmaId: string; lemma: string; pos: string; source: string }>
  skipped: Array<{ lemma: string; reason: string }>
  unknownTokens: string[]
}

export default function Import() {
  const [searchParams] = useSearchParams()
  const initialListId = () => searchParams.listId ?? ''

  const [step, setStep] = createSignal<Step>('input')
  const [text, setText] = createSignal('')
  const [listId, setListId] = createSignal(initialListId())
  const [skipAmbiguous, setSkipAmbiguous] = createSignal(true)
  const [candidates, setCandidates] = createSignal<Candidate[]>([])
  const [result, setResult] = createSignal<ImportResult | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const [lists] = createResource(() => api.lists.list({}))

  const handlePreview = async () => {
    const t = text().trim()
    if (!t) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.import.preview({
        text: t,
        ...(listId() ? { listId: listId() } : {}),
      })
      setCandidates(res.candidates)
      setStep('preview')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    const t = text().trim()
    if (!t) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.import.commit({
        text: t,
        skipAmbiguous: skipAmbiguous(),
        ...(listId() ? { listId: listId() } : {}),
      })
      setResult(res)
      setStep('result')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setText('')
    setCandidates([])
    setResult(null)
    setError(null)
    setStep('input')
  }

  return (
    <div class={css({ py: '4' })}>
      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '6' })}>Import</h1>

      <Switch>
        <Match when={step() === 'input'}>
          <Card>
            <div class={css({ mb: '4' })}>
              <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1' })}>
                Polish text
              </label>
              <textarea
                class={css({
                  display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
                  borderRadius: 'md', border: '1px solid', borderColor: 'border',
                  bg: 'bg', color: 'fg', outline: 'none', minH: '150px', resize: 'vertical',
                  fontFamily: 'system-ui, sans-serif',
                  _focus: { borderColor: 'primary' },
                })}
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
                placeholder="Paste Polish text here..."
              />
            </div>

            <div class={css({ mb: '4' })}>
              <label class={css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1' })}>
                Add to list (optional)
              </label>
              <select
                class={css({
                  px: '3', py: '2', fontSize: 'sm', borderRadius: 'md',
                  border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg',
                  w: 'full',
                })}
                value={listId()}
                onChange={(e) => setListId(e.currentTarget.value)}
              >
                <option value="">No list</option>
                <Show when={lists()}>
                  {(data) => (
                    <For each={data()}>
                      {(list) => <option value={list.id}>{list.name}</option>}
                    </For>
                  )}
                </Show>
              </select>
            </div>

            <Show when={error()}>
              <ErrorState message={error()!} onRetry={() => setError(null)} />
            </Show>

            <Button onClick={handlePreview} loading={loading()} disabled={!text().trim()}>
              Preview
            </Button>
          </Card>
        </Match>

        <Match when={step() === 'preview'}>
          <div class={css({ mb: '4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' })}>
            <p class={css({ color: 'fg.muted', fontSize: 'sm' })}>
              {candidates().length} candidate{candidates().length !== 1 ? 's' : ''} found
              {' \u00B7 '}
              {candidates().filter((c) => c.alreadyExists).length} already exist
              {' \u00B7 '}
              {candidates().filter((c) => c.ambiguous).length} ambiguous
            </p>
          </div>

          <Show when={candidates().length > 0}>
            <table class={css({ w: 'full', borderCollapse: 'collapse', mb: '4' })}>
              <thead>
                <tr class={css({ borderBottom: '2px solid', borderColor: 'border' })}>
                  <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Lemma</th>
                  <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>POS</th>
                  <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Found as</th>
                  <th class={css({ textAlign: 'left', p: '3', fontSize: 'sm', fontWeight: 'semibold' })}>Status</th>
                </tr>
              </thead>
              <tbody>
                <For each={candidates()}>
                  {(c) => (
                    <tr class={css({ borderBottom: '1px solid', borderColor: 'border', _hover: { bg: 'bg.subtle' } })}>
                      <td class={css({ p: '3', fontWeight: 'medium' })}>{c.lemma}</td>
                      <td class={css({ p: '3' })}><Badge variant="pos" value={c.pos} /></td>
                      <td class={css({ p: '3', color: 'fg.muted', fontSize: 'sm' })}>
                        {c.formsFound.join(', ')}
                      </td>
                      <td class={css({ p: '3' })}>
                        <div class={css({ display: 'flex', gap: '1', flexWrap: 'wrap' })}>
                          <Show when={c.ambiguous}><Badge value="ambiguous" variant="default" /></Show>
                          <Show when={c.alreadyExists}><Badge value="exists" variant="default" /></Show>
                          <Show when={c.isMultiWord}><Badge value="multi-word" variant="default" /></Show>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>

          <div class={css({ mb: '4' })}>
            <label class={css({ display: 'flex', alignItems: 'center', gap: '2', fontSize: 'sm', cursor: 'pointer' })}>
              <input
                type="checkbox"
                checked={skipAmbiguous()}
                onChange={(e) => setSkipAmbiguous(e.currentTarget.checked)}
              />
              Skip ambiguous candidates
            </label>
          </div>

          <Show when={error()}>
            <ErrorState message={error()!} onRetry={() => setError(null)} />
          </Show>

          <div class={css({ display: 'flex', gap: '3' })}>
            <Button variant="ghost" onClick={() => setStep('input')}>Back</Button>
            <Button onClick={handleImport} loading={loading()}>
              Import
            </Button>
          </div>
        </Match>

        <Match when={step() === 'result'}>
          <Show when={result()}>
            {(res) => (
              <Card>
                <div class={css({ textAlign: 'center', py: '4' })}>
                  <p class={css({ fontSize: 'xl', fontWeight: 'bold', mb: '2' })}>
                    Import complete
                  </p>
                  <p class={css({ color: 'fg.muted', mb: '4' })}>
                    {res().created.length} created \u00B7 {res().skipped.length} skipped
                  </p>

                  <Show when={res().created.length > 0}>
                    <div class={css({ mb: '4', textAlign: 'left' })}>
                      <h3 class={css({ fontSize: 'sm', fontWeight: 'semibold', mb: '2' })}>Created</h3>
                      <div class={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                        <For each={res().created}>
                          {(c) => (
                            <A href={`/lemmas/${c.lemmaId}`} class={css({ textDecoration: 'none' })}>
                              <Badge variant="pos" value={`${c.lemma} (${c.pos})`} />
                            </A>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <Show when={res().skipped.length > 0}>
                    <div class={css({ mb: '4', textAlign: 'left' })}>
                      <h3 class={css({ fontSize: 'sm', fontWeight: 'semibold', mb: '2' })}>Skipped</h3>
                      <div class={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                        <For each={res().skipped}>
                          {(s) => <Badge value={`${s.lemma} (${s.reason})`} />}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <div class={css({ display: 'flex', gap: '3', justifyContent: 'center', mt: '4' })}>
                    <Button variant="outline" onClick={reset}>Import more</Button>
                    <Show when={listId()}>
                      <A href={`/lists/${listId()}`} class={css({ textDecoration: 'none' })}>
                        <Button variant="solid">Go to list</Button>
                      </A>
                    </Show>
                    <Show when={!listId()}>
                      <A href="/lists" class={css({ textDecoration: 'none' })}>
                        <Button variant="solid">Go to lists</Button>
                      </A>
                    </Show>
                  </div>
                </div>
              </Card>
            )}
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
