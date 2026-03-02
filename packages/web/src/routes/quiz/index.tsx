import {
  createSignal, createMemo, createEffect, Show, Switch, Match, For, onMount,
} from 'solid-js'
import { css } from '../../../styled-system/css'
import { api } from '../../api/client'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Spinner } from '../../components/Spinner'
import { ErrorState } from '../../components/ErrorState'
import { formatTag } from '../../utils/tag-label'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DueCard {
  id: string
  kind: string
  tag: string | null
  state: number
  lemmaText: string | null
  front: string | null
  back: string | null
  forms: string[]
}

type Phase =
  | 'loading'
  | 'asking'
  | 'revealed-correct'
  | 'revealed-wrong'
  | 'revealed-manual'
  | 'done'
  | 'error'

// ---------------------------------------------------------------------------
// Session info bar
// ---------------------------------------------------------------------------

interface SessionInfoProps {
  total: number
  reviewed: number
  correct: number
  streak: number
  lastResult: 'correct' | 'incorrect' | null
}

function SessionInfo(props: SessionInfoProps) {
  return (
    <div class={css({
      display: 'flex',
      alignItems: 'center',
      gap: '6',
      py: '3',
      px: '4',
      bg: 'bg',
      border: '1px solid',
      borderColor: 'border',
      borderRadius: 'l3',
      mb: '6',
      fontSize: 'sm',
      color: 'fg.muted',
      flexWrap: 'wrap',
    })}>
      <span>
        <span class={css({ fontWeight: 'semibold', color: 'fg.default' })}>{props.reviewed}</span>
        /{props.total} reviewed
      </span>
      <span>
        <span class={css({ fontWeight: 'semibold', color: 'fg.default' })}>{props.total - props.reviewed}</span>
        {' '}remaining
      </span>
      <span>
        Streak:{' '}
        <span class={css({ fontWeight: 'semibold', color: props.streak > 0 ? 'green.9' : 'fg.default' })}>
          {props.streak}
        </span>
      </span>
      <Show when={props.lastResult !== null}>
        <span class={css({
          fontWeight: 'semibold',
          color: props.lastResult === 'correct' ? 'green.9' : 'red.9',
        })}>
          Last: {props.lastResult === 'correct' ? '✓ correct' : '✗ incorrect'}
        </span>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rating buttons
// ---------------------------------------------------------------------------

interface RatingOption {
  label: string
  desc: string
  rating: 1 | 2 | 3 | 4
  variant?: 'solid' | 'outline' | 'danger'
  /** If true, this button receives focus when the set mounts */
  defaultFocus?: boolean
}

interface RatingButtonsProps {
  options: RatingOption[]
  onRate: (rating: 1 | 2 | 3 | 4) => void
  disabled: boolean
}

function RatingButtons(props: RatingButtonsProps) {
  // We hold a ref to the button that should receive default focus.
  let defaultRef: HTMLButtonElement | undefined

  // Focus the default button whenever this component's disabled state flips to false
  // (i.e. right after it mounts or after submitting is cleared).
  createEffect(() => {
    if (!props.disabled) {
      setTimeout(() => defaultRef?.focus(), 0)
    }
  })

  return (
    <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap', mt: '4' })}>
      <For each={props.options}>
        {(opt) => (
          <button
            ref={(el) => { if (opt.defaultFocus) defaultRef = el }}
            disabled={props.disabled}
            onClick={() => props.onRate(opt.rating)}
            class={css({
              display: 'flex',
              flexDir: 'column',
              alignItems: 'center',
              px: '4',
              py: '2',
              borderRadius: 'l2',
              border: '1px solid',
              cursor: 'pointer',
              transition: 'all 0.15s',
              minW: '80px',
              _disabled: { opacity: '0.5', cursor: 'not-allowed' },
              ...(opt.variant === 'danger'
                ? { bg: 'red.9', borderColor: 'red.9', color: 'white', _hover: { bg: 'red.10' } }
                : opt.variant === 'solid'
                ? { bg: 'accent.9', borderColor: 'accent.9', color: 'white', _hover: { bg: 'accent.10' } }
                : { bg: 'bg', borderColor: 'border', color: 'fg.default', _hover: { borderColor: 'fg.muted', bg: 'bg.subtle' } }
              ),
            })}
          >
            <span class={css({ fontWeight: 'semibold', fontSize: 'sm' })}>{opt.label}</span>
            <span class={css({ fontSize: 'xs', color: opt.variant ? 'inherit' : 'fg.muted', opacity: '0.85' })}>
              {opt.desc}
            </span>
          </button>
        )}
      </For>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main quiz component
// ---------------------------------------------------------------------------

export default function Quiz() {
  const [phase, setPhase] = createSignal<Phase>('loading')
  const [cards, setCards] = createSignal<DueCard[]>([])
  const [index, setIndex] = createSignal(0)
  const [answer, setAnswer] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [submitting, setSubmitting] = createSignal(false)

  // Session stats
  const [reviewed, setReviewed] = createSignal(0)
  const [correct, setCorrect] = createSignal(0)
  const [streak, setStreak] = createSignal(0)
  const [lastResult, setLastResult] = createSignal<'correct' | 'incorrect' | null>(null)

  const currentCard = createMemo(() => cards()[index()])
  const total = createMemo(() => cards().length)

  // Refs for focus management
  let inputRef: HTMLInputElement | undefined
  let nextBtnRef: HTMLButtonElement | undefined

  // Focus the right element whenever the phase changes.
  // createEffect runs after DOM updates, so refs are populated by the time this fires.
  createEffect(() => {
    const p = phase()
    if (p === "asking") setTimeout(() => inputRef?.focus(), 0)
    else if (p === "revealed-wrong") setTimeout(() => nextBtnRef?.focus(), 0)
    // 'revealed-correct' and 'revealed-manual' are handled inside RatingButtons
    // via their own createEffect (triggered when disabled flips false).
  })

  onMount(async () => {
    try {
      const due = await api.session.due({}) as unknown as DueCard[]
      setCards(due)
      setPhase(due.length === 0 ? 'done' : 'asking')
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  })

  const checkAnswer = () => {
    const card = currentCard()
    if (!card) return

    if (card.kind === 'basic_forward' || card.forms.length === 0) {
      setPhase('revealed-manual')
      return
    }

    const userAnswer = answer().trim()
    const ok = card.forms.some(f => f.toLowerCase() === userAnswer.toLowerCase())
    setPhase(ok ? 'revealed-correct' : 'revealed-wrong')
  }

  const submitReview = async (rating: 1 | 2 | 3 | 4) => {
    const card = currentCard()
    if (!card || submitting()) return
    setSubmitting(true)

    try {
      await api.session.review({ cardId: card.id, rating })
    } catch (err) {
      console.error('Failed to record review:', err)
    }

    const wasCorrect = rating >= 2
    setReviewed(r => r + 1)
    if (wasCorrect) {
      setCorrect(c => c + 1)
      setStreak(s => s + 1)
      setLastResult('correct')
    } else {
      setStreak(0)
      setLastResult('incorrect')
    }

    const next = index() + 1
    if (next >= cards().length) {
      setPhase('done')
    } else {
      setIndex(next)
      setAnswer('')
      setPhase('asking')
    }

    setSubmitting(false)
  }

  return (
    <div class={css({ py: '4', maxW: '640px', mx: 'auto' })}>
      <h1 class={css({ fontSize: '2xl', fontWeight: 'bold', mb: '6', color: 'fg.default' })}>
        Quiz
      </h1>

      <Switch>
        {/* Loading */}
        <Match when={phase() === 'loading'}>
          <div class={css({ display: 'flex', justifyContent: 'center', py: '12' })}>
            <Spinner size="lg" />
          </div>
        </Match>

        {/* Error */}
        <Match when={phase() === 'error'}>
          <ErrorState
            message={error() ?? 'Failed to load quiz session'}
            onRetry={() => window.location.reload()}
          />
        </Match>

        {/* Done */}
        <Match when={phase() === 'done'}>
          <Show
            when={total() === 0}
            fallback={
              <Card title="Session complete">
                <div class={css({ textAlign: 'center', py: '4' })}>
                  <p class={css({ fontSize: '4xl', mb: '2' })}>🎉</p>
                  <p class={css({ fontSize: 'xl', fontWeight: 'semibold', color: 'fg.default', mb: '4' })}>
                    {correct()}/{reviewed()} correct
                  </p>
                  <p class={css({ color: 'fg.muted', mb: '6' })}>
                    {correct() === reviewed()
                      ? 'Perfect session!'
                      : `${Math.round((correct() / reviewed()) * 100)}% accuracy`}
                  </p>
                  <Button variant="solid" onClick={() => window.location.reload()}>
                    Start new session
                  </Button>
                </div>
              </Card>
            }
          >
            <Card title="Nothing due">
              <p class={css({ color: 'fg.muted', mb: '4' })}>
                No cards are due right now. Come back later!
              </p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Check again
              </Button>
            </Card>
          </Show>
        </Match>

        {/* Active quiz */}
        <Match when={
          phase() === 'asking' ||
          phase() === 'revealed-correct' ||
          phase() === 'revealed-wrong' ||
          phase() === 'revealed-manual'
        }>
          <Show when={currentCard()}>
            {(card) => (
              <>
                <SessionInfo
                  total={total()}
                  reviewed={reviewed()}
                  correct={correct()}
                  streak={streak()}
                  lastResult={lastResult()}
                />

                <Card>
                  <div class={css({ fontSize: 'xs', color: 'fg.muted', mb: '4' })}>
                    Card {index() + 1} of {total()}
                  </div>

                  {/* Prompt */}
                  <div class={css({ mb: '6' })}>
                    <Show when={card().kind !== 'basic_forward'} fallback={
                      <>
                        <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                          Basic card
                        </p>
                        <p class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
                          {card().front}
                        </p>
                      </>
                    }>
                      <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                        {formatTag(card().tag ?? '')}
                      </p>
                      <p class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
                        {card().lemmaText}
                      </p>
                      <Show when={card().forms.length === 0}>
                        <p class={css({ fontSize: 'sm', color: 'fg.muted', mt: '1', fontStyle: 'italic' })}>
                          (manual entry — self-assess)
                        </p>
                      </Show>
                    </Show>
                  </div>

                  {/* ── Asking ── */}
                  <Show when={phase() === 'asking'}>
                    <Show when={card().kind !== 'basic_forward'} fallback={
                      <Button variant="solid" onClick={checkAnswer}>
                        Reveal
                      </Button>
                    }>
                      <div class={css({ display: 'flex', gap: '3', alignItems: 'stretch' })}>
                        <input
                          ref={(el) => { inputRef = el }}
                          type="text"
                          placeholder="Type the correct form…"
                          value={answer()}
                          onInput={(e) => setAnswer(e.currentTarget.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') checkAnswer() }}
                          class={css({
                            flex: '1',
                            px: '3',
                            py: '2',
                            borderRadius: 'l2',
                            border: '1px solid',
                            borderColor: 'border',
                            bg: 'bg',
                            color: 'fg.default',
                            fontSize: 'md',
                            outline: 'none',
                            _focus: { borderColor: 'accent.9', ring: '2px', ringColor: 'accent.a4' },
                            _placeholder: { color: 'fg.subtle' },
                          })}
                        />
                        <Button variant="solid" onClick={checkAnswer} disabled={answer().trim() === ''}>
                          Submit
                        </Button>
                      </div>
                    </Show>
                  </Show>

                  {/* ── Correct reveal ── */}
                  <Show when={phase() === 'revealed-correct'}>
                    <div class={css({
                      p: '4', borderRadius: 'l2', bg: 'green.2',
                      border: '1px solid', borderColor: 'green.6', mb: '2',
                    })}>
                      <p class={css({ color: 'green.11', fontWeight: 'semibold', mb: '1' })}>✓ Correct!</p>
                      <p class={css({ color: 'green.10', fontSize: 'sm' })}>
                        Your answer: <strong>{answer()}</strong>
                      </p>
                    </div>
                    <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '2' })}>
                      How easy was that recall?
                    </p>
                    <RatingButtons
                      options={[
                        { label: 'Hard', desc: 'correct, difficult', rating: 2 },
                        { label: 'Good', desc: 'normal effort', rating: 3, variant: 'solid', defaultFocus: true },
                        { label: 'Easy', desc: 'came right away', rating: 4 },
                      ]}
                      onRate={submitReview}
                      disabled={submitting()}
                    />
                  </Show>

                  {/* ── Wrong reveal ── */}
                  <Show when={phase() === 'revealed-wrong'}>
                    <div class={css({
                      p: '4', borderRadius: 'l2', bg: 'red.2',
                      border: '1px solid', borderColor: 'red.6', mb: '4',
                    })}>
                      <p class={css({ color: 'red.11', fontWeight: 'semibold', mb: '1' })}>✗ Incorrect</p>
                      <Show when={answer().trim() !== ''}>
                        <p class={css({ color: 'red.10', fontSize: 'sm', mb: '1' })}>
                          Your answer: <strong>{answer()}</strong>
                        </p>
                      </Show>
                      <p class={css({ color: 'fg.default', fontSize: 'sm' })}>
                        Correct form{card().forms.length > 1 ? 's' : ''}:{' '}
                        <strong>{card().forms.join(' / ')}</strong>
                      </p>
                    </div>
                    <button
                      ref={(el) => { nextBtnRef = el }}
                      disabled={submitting()}
                      onClick={() => submitReview(1)}
                      class={css({
                        px: '4', py: '2', borderRadius: 'l2',
                        border: '1px solid', borderColor: 'border',
                        bg: 'bg', color: 'fg.default', cursor: 'pointer',
                        fontSize: 'sm', fontWeight: 'medium',
                        transition: 'all 0.15s',
                        _hover: { borderColor: 'fg.muted', bg: 'bg.subtle' },
                        _disabled: { opacity: '0.5', cursor: 'not-allowed' },
                        _focus: { outline: '2px solid', outlineColor: 'accent.9', outlineOffset: '2px' },
                      })}
                    >
                      {submitting() ? 'Saving…' : 'Next →'}
                    </button>
                  </Show>

                  {/* ── Manual reveal ── */}
                  <Show when={phase() === 'revealed-manual'}>
                    <div class={css({
                      p: '4', borderRadius: 'l2', bg: 'bg.subtle',
                      border: '1px solid', borderColor: 'border', mb: '2',
                    })}>
                      <Show when={card().kind === 'basic_forward'} fallback={
                        <p class={css({ color: 'fg.muted', fontSize: 'sm' })}>
                          No forms on record — rate your recall honestly.
                        </p>
                      }>
                        <p class={css({ fontSize: 'lg', fontWeight: 'semibold', color: 'fg.default' })}>
                          {card().back}
                        </p>
                      </Show>
                    </div>
                    <RatingButtons
                      options={[
                        { label: 'Again', desc: 'forgot', rating: 1, variant: 'danger' },
                        { label: 'Hard', desc: 'difficult', rating: 2 },
                        { label: 'Good', desc: 'recalled', rating: 3, variant: 'solid', defaultFocus: true },
                        { label: 'Easy', desc: 'effortless', rating: 4 },
                      ]}
                      onRate={submitReview}
                      disabled={submitting()}
                    />
                  </Show>
                </Card>
              </>
            )}
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
