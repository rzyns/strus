import { For } from 'solid-js'
import { css } from '../../../styled-system/css'
import {
  parseNKJP, CASE_ORDER, CASE_LABELS,
  type MorphFormData, type NKJPCase, type NKJPNumber,
} from '../../utils/nkjp'

const tableWrapper = css({ overflowX: 'auto', w: 'full', mb: '6' })
const table = css({ borderCollapse: 'collapse', w: 'full' })
const colHeader = css({ fontSize: 'xs', fontWeight: 'semibold', textTransform: 'uppercase', color: 'fg.muted', pb: '2', px: '3', textAlign: 'left' })
const rowLabel = css({ fontSize: 'sm', color: 'fg.muted', fontWeight: 'medium', pr: '4', py: '1.5', whiteSpace: 'nowrap' })
const cell = css({ fontFamily: 'mono', fontSize: 'sm', py: '1.5', px: '3' })
const emptyCell = css({ color: 'fg.subtle' })
const rowBorder = css({ borderBottom: '1px solid', borderColor: 'border' })

export function NounTable(props: { forms: MorphFormData[] }) {
  const lookup = () => {
    const map = new Map<NKJPCase, Map<NKJPNumber, string>>()
    for (const cas of CASE_ORDER) {
      map.set(cas, new Map())
    }
    for (const form of props.forms) {
      const parsed = parseNKJP(form.tag)
      if (parsed.pos !== 'subst') continue
      for (const num of parsed.number ?? []) {
        for (const cas of parsed.cases ?? []) {
          map.get(cas)?.set(num, form.orth)
        }
      }
    }
    return map
  }

  return (
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
          <For each={CASE_ORDER}>
            {(cas) => (
              <tr class={rowBorder}>
                <td class={rowLabel}>{CASE_LABELS[cas]}</td>
                <td class={cell}>
                  {lookup().get(cas)?.get('sg') ?? <span class={emptyCell}>{'\u2014'}</span>}
                </td>
                <td class={cell}>
                  {lookup().get(cas)?.get('pl') ?? <span class={emptyCell}>{'\u2014'}</span>}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}
