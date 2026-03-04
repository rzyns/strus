import { createResource, createSignal, For, Show, Switch, Match } from 'solid-js'
import { A, useSearchParams } from '@solidjs/router'
import { css } from '../../styled-system/css'
import { api } from '../api/client'
import { Button } from '../components/Button'
import { Badge } from '../components/Badge'
import { Card } from '../components/Card'
import { ErrorState } from '../components/ErrorState'
import * as Table from '../components/ui/table'

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group ambiguous candidates by the set of surface forms they share.
 * Returns an array of groups, each with a display key and the competing candidates.
 */
function groupAmbiguous(candidates: Candidate[]): Array<{ key: string; candidates: Candidate[] }> {
  const map = new Map<string, Candidate[]>()
  for (const c of candidates) {
    if (!c.ambiguous) continue
    const key = [...c.formsFound].sort().join('\x00')
    const existing = map.get(key)
    if (existing) existing.push(c)
    else map.set(key, [c])
  }
  return [...map.entries()].map(([key, cands]) => ({
    key: key.replaceAll('\x00', ', '),
    candidates: cands,
  }))
}

// ---------------------------------------------------------------------------
// Styles (shared)
// ---------------------------------------------------------------------------

const inputStyle = css({
  display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
  borderRadius: 'l2', border: '1px solid', borderColor: 'border',
  bg: 'bg', color: 'fg.default', outline: 'none',
  _focus: { borderColor: 'blue.8', boxShadow: '0 0 0 1px {colors.blue.8}' },
})

const selectStyle = css({
  px: '3', py: '2', fontSize: 'sm', borderRadius: 'l2',
  border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg.default', w: 'full',
})

const labelStyle = css({ display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default' })

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Import() {
  const [searchParams] = useSearchParams()
  const initialListId = () => { const v = searchParams.listId; return typeof v === 'string' ? v : '' }

  const [step, setStep] = createSignal<Step>('input')
  const [text, setText] = createSignal('')
  const [listId, setListId] = createSignal(initialListId())
  const [candidates, setCandidates] = createSignal<Candidate[]>([])
  const [result, setResult] = createSignal<ImportResult | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Disambiguation selections: groupKey → selected lemma string, or '' for "skip"
  const [disambig, setDisambig] = createSignal<Map<string, string>>(new Map())

  const [lists] = createResource(() => api.lists.list({}))

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const clearCandidates = candidates
  const ambigGroups = () => groupAmbiguous(candidates())
  const nonAmbigCandidates = () => candidates().filter((c) => !c.ambiguous)
  const hasAmbig = () => ambigGroups().length > 0

  const includeLemmas = (): string[] => {
    const out: string[] = []
    for (const [_key, lemma] of disambig()) {
      if (lemma) out.push(lemma)
    }
    return out
  }

  const willCreate = () => {
    const nonAmbig = nonAmbigCandidates().filter((c) => !c.alreadyExists).length
    return nonAmbig + includeLemmas().length
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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
      // Initialise disambiguation map — default all groups to '' (skip)
      const map = new Map<string, string>()
      for (const g of groupAmbiguous(res.candidates)) {
        map.set(g.key, '')
      }
      setDisambig(map)
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
      const selected = includeLemmas()
      const res = await api.import.commit({
        text: t,
        skipAmbiguous: true,
        ...(selected.length > 0 ? { includeLemmas: selected } : {}),
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

  const setDisambigChoice = (key: string, lemma: string) => {
    setDisambig((prev) => new Map([...prev, [key, lemma]]))
  }

  const reset = () => {
    setText('')
    setCandidates([])
    setResult(null)
    setError(null)
    setDisambig(new Map())
    setStep('input')
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div class={css({ py: '4' })}>
      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '6', color: 'fg.default' })}>Import</h1>

      <Switch>

        {/* ------------------------------------------------------------------ */}
        {/* Step: input                                                         */}
        {/* ------------------------------------------------------------------ */}
        <Match when={step() === 'input'}>
          <Card>
            <div class={css({ mb: '4' })}>
              <label class={labelStyle}>Polish text</label>
              <textarea
                class={`${inputStyle} ${css({ minH: '150px', resize: 'vertical', fontFamily: "'Inter', system-ui, sans-serif" })}`}
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
                placeholder="Paste Polish text here..."
              />
            </div>

            <div class={css({ mb: '4' })}>
              <label class={labelStyle}>Add to list (optional)</label>
              <select class={selectStyle} value={listId()} onChange={(e) => setListId(e.currentTarget.value)}>
                <option value="">No list</option>
                <Show when={lists()}>
                  {(data) => (
                    <For each={data()}>
                      {(list: any) => <option value={list.id}>{list.name}</option>}
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

        {/* ------------------------------------------------------------------ */}
        {/* Step: preview                                                       */}
        {/* ------------------------------------------------------------------ */}
        <Match when={step() === 'preview'}>

          {/* Summary line */}
          <p class={css({ color: 'fg.muted', fontSize: 'sm', mb: '4' })}>
            {candidates().length} candidate{candidates().length !== 1 ? 's' : ''} found
            {' · '}
            {candidates().filter((c) => c.alreadyExists).length} already exist
            {' · '}
            {ambigGroups().length} need{ambigGroups().length !== 1 ? '' : 's'} disambiguation
          </p>

          {/* ---- Disambiguation section ---- */}
          <Show when={hasAmbig()}>
            <div class={css({ mb: '6' })}>
              <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '3', color: 'fg.default' })}>
                Needs disambiguation
              </h2>
              <div class={css({ display: 'flex', flexDir: 'column', gap: '3' })}>
                <For each={ambigGroups()}>
                  {(group) => {
                    const currentChoice = () => disambig().get(group.key) ?? ''
                    return (
                      <div class={css({
                        border: '1px solid', borderColor: 'border', borderRadius: 'l2',
                        p: '4', bg: 'bg.subtle',
                      })}>
                        <p class={css({ fontSize: 'sm', fontWeight: 'medium', mb: '3', color: 'fg.default' })}>
                          Which lemma for{' '}
                          <span class={css({ fontStyle: 'italic' })}>{group.key}</span>?
                        </p>
                        <div class={css({ display: 'flex', flexDir: 'column', gap: '2' })}>
                          {/* Skip option */}
                          <label class={css({ display: 'flex', alignItems: 'center', gap: '2', fontSize: 'sm', cursor: 'pointer', color: 'fg.muted' })}>
                            <input
                              type="radio"
                              name={`disambig-${group.key}`}
                              value=""
                              checked={currentChoice() === ''}
                              onChange={() => setDisambigChoice(group.key, '')}
                            />
                            Skip this word
                          </label>
                          {/* One option per competing lemma */}
                          <For each={group.candidates}>
                            {(c) => (
                              <label class={css({ display: 'flex', alignItems: 'center', gap: '2', fontSize: 'sm', cursor: 'pointer', color: 'fg.default' })}>
                                <input
                                  type="radio"
                                  name={`disambig-${group.key}`}
                                  value={c.lemma}
                                  checked={currentChoice() === c.lemma}
                                  onChange={() => setDisambigChoice(group.key, c.lemma)}
                                />
                                <span class={css({ fontWeight: 'medium' })}>{c.lemma}</span>
                                <Badge variant="pos" value={c.pos} />
                              </label>
                            )}
                          </For>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </Show>

          {/* ---- Unambiguous candidates table ---- */}
          <Show when={nonAmbigCandidates().length > 0}>
            <div class={css({ mb: '6' })}>
              <h2 class={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '3', color: 'fg.default' })}>
                Candidates
              </h2>
              <Table.Root>
                <Table.Head>
                  <Table.Row>
                    <Table.Header>Lemma</Table.Header>
                    <Table.Header>POS</Table.Header>
                    <Table.Header>Found as</Table.Header>
                    <Table.Header>Status</Table.Header>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  <For each={nonAmbigCandidates()}>
                    {(c) => (
                      <Table.Row>
                        <Table.Cell class={css({ fontWeight: 'medium' })}>{c.lemma}</Table.Cell>
                        <Table.Cell><Badge variant="pos" value={c.pos} /></Table.Cell>
                        <Table.Cell class={css({ color: 'fg.muted', fontSize: 'sm' })}>{c.formsFound.join(', ')}</Table.Cell>
                        <Table.Cell>
                          <div class={css({ display: 'flex', gap: '1', flexWrap: 'wrap' })}>
                            <Show when={c.alreadyExists}><Badge value="exists" variant="default" /></Show>
                            <Show when={c.isMultiWord}><Badge value="multi-word" variant="default" /></Show>
                            <Show when={!c.alreadyExists && !c.isMultiWord}>
                              <Badge value="will import" variant="default" />
                            </Show>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </For>
                </Table.Body>
              </Table.Root>
            </div>
          </Show>

          <Show when={error()}>
            <ErrorState message={error()!} onRetry={() => setError(null)} />
          </Show>

          <div class={css({ display: 'flex', gap: '3', alignItems: 'center' })}>
            <Button variant="ghost" onClick={() => setStep('input')}>Back</Button>
            <Button onClick={handleImport} loading={loading()} disabled={willCreate() === 0}>
              Import {willCreate() > 0 ? `${willCreate()} lemma${willCreate() !== 1 ? 's' : ''}` : ''}
            </Button>
          </div>
        </Match>

        {/* ------------------------------------------------------------------ */}
        {/* Step: result                                                        */}
        {/* ------------------------------------------------------------------ */}
        <Match when={step() === 'result'}>
          <Show when={result()}>
            {(res) => (
              <Card>
                <div class={css({ textAlign: 'center', py: '4' })}>
                  <p class={css({ fontSize: 'xl', fontWeight: 'bold', mb: '2', color: 'fg.default' })}>
                    Import complete
                  </p>
                  <p class={css({ color: 'fg.muted', mb: '4' })}>
                    {res().created.length} created · {res().skipped.length} skipped
                  </p>

                  <Show when={res().created.length > 0}>
                    <div class={css({ mb: '4', textAlign: 'left' })}>
                      <h3 class={css({ fontSize: 'sm', fontWeight: 'semibold', mb: '2', color: 'fg.default' })}>Created</h3>
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
                      <h3 class={css({ fontSize: 'sm', fontWeight: 'semibold', mb: '2', color: 'fg.default' })}>Skipped</h3>
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
