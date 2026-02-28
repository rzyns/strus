import {
  createSignal, createMemo, Show, Switch, Match, For, onMount,
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
  lemmaId: string
  tag: string
  state: number
  lemmaText: string
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
        <span class={css({ fontWeight: 'semibold', color: 'fg.default' })}>
          {props.reviewed}
        </span>
        /{props.total} reviewed
      </span>
      <span>
        <span class={css({ fontWeight: 'semibold', color: 'fg.default' })}>
          {props.total - props.reviewed}
        </span>{' '}remaining
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

interface RatingButtonsProps {
  options: Array<{ label: string; desc: string; rating: 1 | 2 | 3 | 4; variant?: 'solid' | 'outline' | 'danger' }>
  onRate: (rating: 1 | 2 | 3 | 4) => void
  disabled: boolean
}

function RatingButtons(props: RatingButtonsProps) {
  return (
    <div class={css({ display: 'flex', gap: '3', flexWrap: 'wrap', mt: '4' })}>
      <For each={props.options}>
        {(opt) => (
          <button
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
            <span class={css({ fontSize: 'xs', color: opt.variant ? 'inherit' : 'fg.muted', opacity: '0.85' })}>{opt.desc}</span>
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
  const [isCorrect, setIsCorrect] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [submitting, setSubmitting] = createSignal(false)

  // Session stats
  const [reviewed, setReviewed] = createSignal(0)
  const [correct, setCorrect] = createSignal(0)
  const [streak, setStreak] = createSignal(0)
  const [lastResult, setLastResult] = createSignal<'correct' | 'incorrect' | null>(null)

  const currentCard = createMemo(() => cards()[index()])
  const total = createMemo(() => cards().length)

  onMount(async () => {
    try {
      const due = await api.session.due({}) as DueCard[]
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

    if (card.forms.length === 0) {
      setPhase('revealed-manual')
      return
    }

    const userAnswer = answer().trim()
    const ok = card.forms.some(f => f.toLowerCase() === userAnswer.toLowerCase())
    setIsCorrect(ok)
    setPhase(ok ? 'revealed-correct' : 'revealed-wrong')
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && phase() === 'asking') {
      checkAnswer()
    }
  }

  const submitReview = async (rating: 1 | 2 | 3 | 4) => {
    const card = currentCard()
    if (!card || submitting()) return
    setSubmitting(true)

    try {
      await api.session.review({ learningTargetId: card.id, rating })
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
                  {/* Card header: position */}
                  <div class={css({ fontSize: 'xs', color: 'fg.muted', mb: '4' })}>
                    Card {index() + 1} of {total()}
                  </div>

                  {/* The prompt */}
                  <div class={css({ mb: '6' })}>
                    <p class={css({ fontSize: 'sm', color: 'fg.muted', mb: '1' })}>
                      {formatTag(card().tag)}
                    </p>
                    <p class={css({ fontSize: '2xl', fontWeight: 'bold', color: 'fg.default' })}>
                      {card().lemmaText}
                    </p>
                    <Show when={card().forms.length === 0}>
                      <p class={css({ fontSize: 'sm', color: 'fg.muted', mt: '1', fontStyle: 'italic' })}>
                        (manual entry — self-assess)
                      </p>
                    </Show>
                  </div>

                  {/* Input area — only shown during 'asking' phase */}
                  <Show when={phase() === 'asking'}>
                    <div class={css({ display: 'flex', gap: '3', alignItems: 'stretch' })}>
                      <input
                        autofocus
                        type="text"
                        placeholder="Type the correct form…"
                        value={answer()}
                        onInput={(e) => setAnswer(e.currentTarget.value)}
                        onKeyDown={handleKeyDown}
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

                  {/* Correct reveal */}
                  <Show when={phase() === 'revealed-correct'}>
                    <div class={css({
                      p: '4',
                      borderRadius: 'l2',
                      bg: 'green.2',
                      border: '1px solid',
                      borderColor: 'green.6',
                      mb: '2',
                    })}>
                      <p class={css({ color: 'green.11', fontWeight: 'semibold', mb: '1' })}>
                        ✓ Correct!
                      </p>
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
                        { label: 'Good', desc: 'normal effort', rating: 3, variant: 'solid' },
                        { label: 'Easy', desc: 'came right away', rating: 4 },
                      ]}
                      onRate={submitReview}
                      disabled={submitting()}
                    />
                  </Show>

                  {/* Wrong reveal */}
                  <Show when={phase() === 'revealed-wrong'}>
                    <div class={css({
                      p: '4',
                      borderRadius: 'l2',
                      bg: 'red.2',
                      border: '1px solid',
                      borderColor: 'red.6',
                      mb: '4',
                    })}>
                      <p class={css({ color: 'red.11', fontWeight: 'semibold', mb: '1' })}>
                        ✗ Incorrect
                      </p>
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
                    <Button
                      variant="outline"
                      onClick={() => submitReview(1)}
                      disabled={submitting()}
                    >
                      {submitting() ? 'Saving…' : 'Next →'}
                    </Button>
                  </Show>

                  {/* Manual (no forms) reveal */}
                  <Show when={phase() === 'revealed-manual'}>
                    <div class={css({
                      p: '4',
                      borderRadius: 'l2',
                      bg: 'bg.subtle',
                      border: '1px solid',
                      borderColor: 'border',
                      mb: '2',
                    })}>
                      <p class={css({ color: 'fg.muted', fontSize: 'sm' })}>
                        No forms on record — rate your recall honestly.
                      </p>
                    </div>
                    <RatingButtons
                      options={[
                        { label: 'Again', desc: 'forgot', rating: 1, variant: 'danger' },
                        { label: 'Hard', desc: 'difficult', rating: 2 },
                        { label: 'Good', desc: 'recalled', rating: 3, variant: 'solid' },
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
