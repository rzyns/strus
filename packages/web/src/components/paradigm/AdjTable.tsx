import { For, Show } from 'solid-js'
import { css } from '../../../styled-system/css'
import {
  parseNKJP, CASE_ORDER, CASE_LABELS, DEGREE_LABELS,
  type MorphFormData, type NKJPCase, type NKJPNumber, type NKJPDegree,
} from '../../utils/nkjp'

const tableWrapper = css({ overflowX: 'auto', w: 'full', mb: '6' })
const table = css({ borderCollapse: 'collapse', w: 'full' })
const colHeader = css({ fontSize: 'xs', fontWeight: 'semibold', textTransform: 'uppercase', color: 'fg.muted', pb: '2', px: '3', textAlign: 'left' })
const rowLabel = css({ fontSize: 'sm', color: 'fg.muted', fontWeight: 'medium', pr: '4', py: '1.5', whiteSpace: 'nowrap' })
const cell = css({ fontFamily: 'mono', fontSize: 'sm', py: '1.5', px: '3' })
const emptyCell = css({ color: 'fg.subtle' })
const rowBorder = css({ borderBottom: '1px solid', borderColor: 'border' })
const sectionHeading = css({ fontSize: 'xs', fontWeight: 'semibold', textTransform: 'uppercase', letterSpacing: 'wide', color: 'fg.muted', mb: '3', mt: '6' })

interface Column {
  label: string
  number: NKJPNumber
  genders: string[]
}

const COLUMNS: Column[] = [
  { label: 'Sg Masc', number: 'sg', genders: ['m1', 'm2', 'm3'] },
  { label: 'Sg Fem', number: 'sg', genders: ['f'] },
  { label: 'Sg Neut', number: 'sg', genders: ['n'] },
  { label: 'Pl M-Pers', number: 'pl', genders: ['m1'] },
  { label: 'Pl Other', number: 'pl', genders: ['m2', 'm3', 'f', 'n'] },
]

export function AdjTable(props: { forms: MorphFormData[] }) {
  const parsed = () => props.forms.map(f => ({ ...parseNKJP(f.tag), orth: f.orth }))

  const degrees = (): NKJPDegree[] => {
    const found = new Set<NKJPDegree>()
    for (const p of parsed()) {
      if (p.pos === 'adj' && p.degree) found.add(p.degree)
    }
    return (['pos', 'com', 'sup'] as NKJPDegree[]).filter(d => found.has(d))
  }

  const findOrth = (degree: NKJPDegree, cas: NKJPCase, col: Column): string | undefined => {
    for (const p of parsed()) {
      if (p.pos !== 'adj') continue
      if (p.degree !== degree) continue
      if (!p.number?.includes(col.number)) continue
      if (!p.cases?.includes(cas)) continue
      if (!p.genders?.some(g => col.genders.includes(g))) continue
      return p.orth
    }
    return undefined
  }

  return (
    <div>
      <For each={degrees()}>
        {(degree) => (
          <>
            <div class={sectionHeading}>{DEGREE_LABELS[degree]}</div>
            <div class={tableWrapper}>
              <table class={table}>
                <thead>
                  <tr>
                    <th class={colHeader} />
                    <For each={COLUMNS}>
                      {(col) => <th class={colHeader}>{col.label}</th>}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={CASE_ORDER}>
                    {(cas) => (
                      <tr class={rowBorder}>
                        <td class={rowLabel}>{CASE_LABELS[cas]}</td>
                        <For each={COLUMNS}>
                          {(col) => (
                            <td class={cell}>
                              {findOrth(degree, cas, col) ?? <span class={emptyCell}>{'\u2014'}</span>}
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </>
        )}
      </For>
    </div>
  )
}
