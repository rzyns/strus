import { createSignal, createResource, createMemo, Show } from 'solid-js'
import Mustache from 'mustache'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Spinner } from '../../components/Spinner'

const labelStyle = css({
  display: 'block', fontSize: 'sm', fontWeight: 'medium', mb: '1', color: 'fg.default',
})
const inputStyle = css({
  display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
  borderRadius: 'l2', border: '1px solid', borderColor: 'border',
  bg: 'bg', color: 'fg.default', outline: 'none',
  _focus: { borderColor: 'blue.8', boxShadow: '0 0 0 1px {colors.blue.8}' },
})
const selectStyle = css({
  px: '3', py: '2', fontSize: 'sm', borderRadius: 'l2',
  border: '1px solid', borderColor: 'border', bg: 'bg', color: 'fg.default',
})

export default function Settings() {
  const [data, { refetch }] = createResource(
    () => api.settings.get({}) as Promise<{ imagePromptTemplate: string; imagePromptTemplateDefault: string }>
  )

  const [template, setTemplate] = createSignal('')
  const [defaultTemplate, setDefaultTemplate] = createSignal('')
  const [loaded, setLoaded] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [feedback, setFeedback] = createSignal<{ type: 'ok' | 'err'; msg: string } | null>(null)

  // Preview inputs
  const [previewWord, setPreviewWord] = createSignal('dom')
  const [previewWordClass, setPreviewWordClass] = createSignal('noun')
  const [previewGender, setPreviewGender] = createSignal('masculine')

  // Populate form when data loads
  createResource(
    () => data(),
    (d) => {
      if (d && !loaded()) {
        setTemplate(d.imagePromptTemplate)
        setDefaultTemplate(d.imagePromptTemplateDefault)
        setLoaded(true)
      }
      return null
    },
  )

  const preview = createMemo(() => {
    try {
      return Mustache.render(template(), {
        word: previewWord(),
        wordClass: previewWordClass(),
        gender: previewGender() === '—' ? '' : previewGender(),
      })
    } catch {
      return '(template error)'
    }
  })

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      await api.settings.set({ imagePromptTemplate: template() })
      setFeedback({ type: 'ok', msg: 'Saved' })
    } catch (e) {
      setFeedback({ type: 'err', msg: e instanceof Error ? e.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setTemplate(defaultTemplate())
    setFeedback(null)
  }

  return (
    <div class={css({ py: '4', maxW: '640px', mx: 'auto' })}>
      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '6', color: 'fg.default' })}>
        Settings
      </h1>

      <Show when={!data.loading} fallback={
        <div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}><Spinner size="lg" /></div>
      }>
        <Card title="Image Generation Meta-Prompt">
          <div class={css({ display: 'flex', flexDir: 'column', gap: '4' })}>
            <p class={css({ fontSize: 'sm', color: 'fg.muted' })}>
              This is sent to the Gemini text model to generate a word-specific image prompt. The generated prompt is then sent to the image generation model.
            </p>
            <p class={css({ fontSize: 'sm', color: 'fg.muted' })}>
              Mustache template variables: <code>{`{{word}}`}</code>, <code>{`{{wordClass}}`}</code>, <code>{`{{gender}}`}</code>
              {' '}(conditional: <code>{`{{#gender}}…{{/gender}}`}</code>)
            </p>

            <div>
              <label class={labelStyle}>Template</label>
              <textarea
                rows={8}
                value={template()}
                onInput={(e) => { setTemplate(e.currentTarget.value); setFeedback(null) }}
                class={css({
                  display: 'block', w: 'full', px: '3', py: '2', fontSize: 'sm',
                  fontFamily: 'monospace', borderRadius: 'l2',
                  border: '1px solid', borderColor: 'border',
                  bg: 'bg', color: 'fg.default', outline: 'none', resize: 'vertical',
                  _focus: { borderColor: 'blue.8', boxShadow: '0 0 0 1px {colors.blue.8}' },
                })}
              />
            </div>

            <div class={css({ display: 'flex', gap: '3', alignItems: 'center', flexWrap: 'wrap' })}>
              <Button variant="solid" onClick={handleSave} disabled={saving()}>
                {saving() ? 'Saving…' : 'Save'}
              </Button>
              <button
                onClick={handleReset}
                class={css({
                  fontSize: 'sm', color: 'blue.9', bg: 'transparent',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline',
                  _hover: { color: 'blue.10' },
                })}
              >
                Reset to default
              </button>
              <Show when={feedback()}>
                {(fb) => (
                  <span class={css({
                    fontSize: 'sm',
                    color: fb().type === 'ok' ? 'green.9' : 'red.9',
                  })}>
                    {fb().msg}
                  </span>
                )}
              </Show>
            </div>
          </div>
        </Card>

        <Card title="Meta-prompt Preview">
          <div class={css({ display: 'flex', gap: '3', mb: '4', flexWrap: 'wrap', alignItems: 'flex-end' })}>
            <div>
              <label class={labelStyle}>Preview word</label>
              <input
                type="text"
                class={inputStyle}
                value={previewWord()}
                onInput={(e) => setPreviewWord(e.currentTarget.value)}
                style={{ width: '120px' }}
              />
            </div>
            <div>
              <label class={labelStyle}>Word class</label>
              <select
                class={selectStyle}
                value={previewWordClass()}
                onChange={(e) => setPreviewWordClass(e.currentTarget.value)}
              >
                <option value="noun">noun</option>
                <option value="verb">verb</option>
                <option value="adjective">adjective</option>
                <option value="adverb">adverb</option>
              </select>
            </div>
            <div>
              <label class={labelStyle}>Gender</label>
              <select
                class={selectStyle}
                value={previewGender()}
                onChange={(e) => setPreviewGender(e.currentTarget.value)}
              >
                <option value="masculine">masculine</option>
                <option value="feminine">feminine</option>
                <option value="neuter">neuter</option>
                <option value="—">—</option>
              </select>
            </div>
          </div>

          <pre class={css({
            fontSize: 'sm', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            p: '4', borderRadius: 'l2', bg: 'bg.subtle', border: '1px solid', borderColor: 'border',
            color: 'fg.default',
          })}>
            {preview()}
          </pre>
        </Card>
      </Show>
    </div>
  )
}
