import { For, Show } from 'solid-js'
import { css } from '../../../styled-system/css'
import {
  parseNKJP, PERSON_ORDER, PERSON_LABELS,
  type MorphFormData, type ParsedNKJP, type NKJPNumber, type NKJPPerson,
} from '../../utils/nkjp'

const tableWrapper = css({ overflowX: 'auto', w: 'full', mb: '6' })
const table = css({ borderCollapse: 'collapse', w: 'full' })
const colHeader = css({ fontSize: 'xs', fontWeight: 'semibold', textTransform: 'uppercase', color: 'fg.muted', pb: '2', px: '3', textAlign: 'left' })
const rowLabel = css({ fontSize: 'sm', color: 'fg.muted', fontWeight: 'medium', pr: '4', py: '1.5', whiteSpace: 'nowrap' })
const cell = css({ fontFamily: 'mono', fontSize: 'sm', py: '1.5', px: '3' })
const emptyCell = css({ color: 'fg.subtle' })
const rowBorder = css({ borderBottom: '1px solid', borderColor: 'border' })
const sectionHeading = css({ fontSize: 'xs', fontWeight: 'semibold', textTransform: 'uppercase', letterSpacing: 'wide', color: 'fg.muted', mb: '3', mt: '6' })
const inlineLabel = css({ fontSize: 'sm', color: 'fg.muted', fontWeight: 'medium', mr: '3' })

function arraysIntersect(a: string[] | undefined, b: string[]): boolean {
  if (!a) return false
  return a.some(v => b.includes(v))
}

export function VerbTable(props: { forms: MorphFormData[] }) {
  const parsed = () => props.forms.map(f => ({ ...parseNKJP(f.tag), orth: f.orth }))

  const findOrth = (criteria: Partial<ParsedNKJP> & { matchGenders?: string[] }): string | undefined => {
    for (const p of parsed()) {
      if (criteria.pos && p.pos !== criteria.pos) continue
      if (criteria.number && !arraysIntersect(p.number, criteria.number)) continue
      if (criteria.person && p.person !== criteria.person) continue
      if (criteria.aspect && p.aspect !== criteria.aspect) continue
      if (criteria.matchGenders && !arraysIntersect(p.genders, criteria.matchGenders)) continue
      return p.orth
    }
    return undefined
  }

  const hasPos = (pos: string) => parsed().some(p => p.pos === pos)

  const infForm = () => findOrth({ pos: 'inf' })
  const hasFin = () => hasPos('fin')
  const hasPraet = () => hasPos('praet')
  const hasImpt = () => hasPos('impt') || hasPos('imps')
  const hasPcon = () => hasPos('pcon') || hasPos('pacta')
  const hasGer = () => hasPos('ger')
  const hasPact = () => hasPos('pact')
  const hasPpas = () => hasPos('ppas')

  return (
    <div>
      {/* Infinitive */}
      <Show when={infForm()}>
        {(form) => (
          <>
            <div class={sectionHeading}>Infinitive</div>
            <div class={css({ fontFamily: 'mono', fontSize: 'sm', mb: '2', pl: '3' })}>{form()}</div>
          </>
        )}
      </Show>

      {/* Present tense */}
      <Show when={hasFin()}>
        <div class={sectionHeading}>Present</div>
        <div class={tableWrapper}>
          <table class={table}>
            <thead>
              <tr>
                <th class={colHeader} />
                <th class={colHeader}>Singular</th>
                <th class={colHeader}>Plural</th>
              </tr>
            </thead>
            <tbody>
              <For each={PERSON_ORDER}>
                {(person) => (
                  <tr class={rowBorder}>
                    <td class={rowLabel}>{PERSON_LABELS[person]}</td>
                    <td class={cell}>
                      {findOrth({ pos: 'fin', number: ['sg'], person }) ?? <span class={emptyCell}>{'\u2014'}</span>}
                    </td>
                    <td class={cell}>
                      {findOrth({ pos: 'fin', number: ['pl'], person }) ?? <span class={emptyCell}>{'\u2014'}</span>}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* Past tense */}
      <Show when={hasPraet()}>
        <div class={sectionHeading}>Past</div>
        <div class={tableWrapper}>
          <table class={table}>
            <thead>
              <tr>
                <th class={colHeader} />
                <th class={colHeader}>Form</th>
              </tr>
            </thead>
            <tbody>
              <For each={[
                { label: 'Sg Masculine', criteria: { pos: 'praet', number: ['sg'] as NKJPNumber[], matchGenders: ['m1', 'm2', 'm3'] } },
                { label: 'Sg Feminine', criteria: { pos: 'praet', number: ['sg'] as NKJPNumber[], matchGenders: ['f'] } },
                { label: 'Sg Neuter', criteria: { pos: 'praet', number: ['sg'] as NKJPNumber[], matchGenders: ['n'] } },
                { label: 'Pl M-Personal', criteria: { pos: 'praet', number: ['pl'] as NKJPNumber[], matchGenders: ['m1'] } },
                { label: 'Pl Non-M-Pers.', criteria: { pos: 'praet', number: ['pl'] as NKJPNumber[], matchGenders: ['m2', 'm3', 'f', 'n'] } },
              ]}>
                {(row) => (
                  <tr class={rowBorder}>
                    <td class={rowLabel}>{row.label}</td>
                    <td class={cell}>
                      {findOrth(row.criteria) ?? <span class={emptyCell}>{'\u2014'}</span>}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* Imperative */}
      <Show when={hasImpt()}>
        <div class={sectionHeading}>Imperative</div>
        <div class={tableWrapper}>
          <table class={table}>
            <thead>
              <tr>
                <th class={colHeader} />
                <th class={colHeader}>Form</th>
              </tr>
            </thead>
            <tbody>
              <For each={[
                { label: '2nd Sg', criteria: { pos: 'impt', number: ['sg'] as NKJPNumber[], person: 'sec' as NKJPPerson } },
                { label: '1st Pl', criteria: { pos: 'impt', number: ['pl'] as NKJPNumber[], person: 'pri' as NKJPPerson } },
                { label: '2nd Pl', criteria: { pos: 'impt', number: ['pl'] as NKJPNumber[], person: 'sec' as NKJPPerson } },
              ]}>
                {(row) => (
                  <tr class={rowBorder}>
                    <td class={rowLabel}>{row.label}</td>
                    <td class={cell}>
                      {findOrth(row.criteria) ?? <span class={emptyCell}>{'\u2014'}</span>}
                    </td>
                  </tr>
                )}
              </For>
              <Show when={findOrth({ pos: 'imps' })}>
                {(form) => (
                  <tr class={rowBorder}>
                    <td class={rowLabel}>Impersonal</td>
                    <td class={cell}>{form()}</td>
                  </tr>
                )}
              </Show>
            </tbody>
          </table>
        </div>
      </Show>

      {/* Adverbial participle */}
      <Show when={hasPcon()}>
        <div class={sectionHeading}>Adverbial Participle</div>
        <div class={css({ pl: '3', mb: '2' })}>
          <Show when={findOrth({ pos: 'pcon' })}>
            {(form) => (
              <div class={css({ display: 'flex', alignItems: 'baseline', mb: '1' })}>
                <span class={inlineLabel}>Contemp.</span>
                <span class={css({ fontFamily: 'mono', fontSize: 'sm' })}>{form()}</span>
              </div>
            )}
          </Show>
          <Show when={findOrth({ pos: 'pacta' })}>
            {(form) => (
              <div class={css({ display: 'flex', alignItems: 'baseline', mb: '1' })}>
                <span class={inlineLabel}>Anterior</span>
                <span class={css({ fontFamily: 'mono', fontSize: 'sm' })}>{form()}</span>
              </div>
            )}
          </Show>
        </div>
      </Show>

      {/* Verbal noun */}
      <Show when={hasGer()}>
        <div class={sectionHeading}>Verbal Noun</div>
        <div class={css({ pl: '3', mb: '2' })}>
          <Show when={findOrth({ pos: 'ger', number: ['sg'], matchGenders: ['n'] })}>
            {(form) => (
              <span class={css({ fontFamily: 'mono', fontSize: 'sm' })}>{form()}</span>
            )}
          </Show>
        </div>
      </Show>

      {/* Active participle */}
      <Show when={hasPact()}>
        <div class={sectionHeading}>Active Participle</div>
        <div class={css({ display: 'flex', gap: '4', pl: '3', mb: '2', flexWrap: 'wrap' })}>
          <For each={[
            { label: 'M', genders: ['m1', 'm2', 'm3'] },
            { label: 'F', genders: ['f'] },
            { label: 'N', genders: ['n'] },
          ]}>
            {(col) => {
              const form = () => findOrth({ pos: 'pact', number: ['sg'], matchGenders: col.genders })
              return (
                <Show when={form()}>
                  {(f) => (
                    <div class={css({ display: 'flex', alignItems: 'baseline' })}>
                      <span class={inlineLabel}>{col.label}</span>
                      <span class={css({ fontFamily: 'mono', fontSize: 'sm' })}>{f()}</span>
                    </div>
                  )}
                </Show>
              )
            }}
          </For>
        </div>
      </Show>

      {/* Passive participle */}
      <Show when={hasPpas()}>
        <div class={sectionHeading}>Passive Participle</div>
        <div class={css({ display: 'flex', gap: '4', pl: '3', mb: '2', flexWrap: 'wrap' })}>
          <For each={[
            { label: 'M', genders: ['m1', 'm2', 'm3'] },
            { label: 'F', genders: ['f'] },
            { label: 'N', genders: ['n'] },
          ]}>
            {(col) => {
              const form = () => findOrth({ pos: 'ppas', number: ['sg'], matchGenders: col.genders })
              return (
                <Show when={form()}>
                  {(f) => (
                    <div class={css({ display: 'flex', alignItems: 'baseline' })}>
                      <span class={inlineLabel}>{col.label}</span>
                      <span class={css({ fontFamily: 'mono', fontSize: 'sm' })}>{f()}</span>
                    </div>
                  )}
                </Show>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
