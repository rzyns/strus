import { For, createMemo } from 'solid-js'
import { css } from '../../../styled-system/css'
import type { MorphFormData } from '../../utils/nkjp'

const tableWrapper = css({ overflowX: 'auto', w: 'full', mb: '6' })
const table = css({ borderCollapse: 'collapse', w: 'full' })
const colHeader = css({ fontSize: 'xs', fontWeight: 'semibold', textTransform: 'uppercase', color: 'fg.muted', pb: '2', px: '3', textAlign: 'left' })
const cell = css({ fontFamily: 'mono', fontSize: 'sm', py: '1.5', px: '3' })
const tagCell = css({ fontSize: 'xs', py: '1.5', px: '3' })
const rowBorder = css({ borderBottom: '1px solid', borderColor: 'border' })

export function FlatFormTable(props: { forms: MorphFormData[] }) {
  const sorted = createMemo(() =>
    [...props.forms].sort((a, b) => a.tag.localeCompare(b.tag))
  )

  return (
    <div class={tableWrapper}>
      <table class={table}>
        <thead>
          <tr>
            <th class={colHeader}>Form</th>
            <th class={colHeader}>Tag</th>
          </tr>
        </thead>
        <tbody>
          <For each={sorted()}>
            {(form) => (
              <tr class={rowBorder}>
                <td class={cell}>{form.orth}</td>
                <td class={tagCell}>
                  <code class={css({ fontSize: 'xs', bg: 'bg.muted', px: '2', py: '0.5', borderRadius: 'sm' })}>
                    {form.tag}
                  </code>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}
