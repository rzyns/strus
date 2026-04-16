import { createResource, createSignal, Suspense, ErrorBoundary, Show, For } from 'solid-js'
import { A } from '@solidjs/router'
import { css } from '../../styled-system/css'
import { api } from '../api/client'
import { Card } from './Card'
import { Spinner } from './Spinner'
import { ErrorState } from './ErrorState'

type KcDueStatus = 'overdue' | 'upcoming' | 'scheduled'

type KcItem = {
  id: string
  kind: string
  label: string
  labelPl: string | null
  currentState: number
  currentDue: string
  currentStability: number
  scheduledDays: number
  reps: number
  lapses: number
  lastReview: string | null
  dueStatus: KcDueStatus
  avgStability: number
  totalCards: number
  overdueCount: number
  masteredCount: number
  masteredPct: number
}

type KcSummary = {
  totalLemmas: number
  masteredLemmas: number
  totalStructural: number
  totalDueCards: number
  structuralDueStates: {
    overdue: number
    upcoming: number
    scheduled: number
  }
  weakestKC: Pick<KcItem, 'id' | 'kind' | 'label' | 'labelPl' | 'avgStability' | 'currentDue' | 'currentStability' | 'dueStatus'> | null
}

const DIMENSION_KINDS = [
  { kind: 'number', label: 'Numbers' },
  { kind: 'gender', label: 'Genders' },
  { kind: 'tense', label: 'Tenses' },
  { kind: 'mood', label: 'Moods' },
  { kind: 'pos', label: 'Parts of Speech' },
] as const

function buildFocusedSessionHref(kc: { id: string; label: string; labelPl: string | null }) {
  const params = new URLSearchParams({ kcId: kc.id })
  if (kc.label) params.set('kcLabel', kc.label)
  if (kc.labelPl) params.set('kcLabelPl', kc.labelPl)
  return `/quiz?${params.toString()}`
}

function masteryColor(pct: number): string {
  if (pct >= 80) return 'green.9'
  if (pct >= 40) return 'yellow.9'
  return 'red.9'
}

function formatStability(stability: number): string {
  if (stability <= 0.1) return 'new'
  if (stability < 10) return `${stability.toFixed(1)}d`
  return `${Math.round(stability)}d`
}

function formatDueHint(dueIso: string, status: KcDueStatus): string {
  const diffMs = new Date(dueIso).getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  const absHours = Math.max(1, Math.round(absMs / (1000 * 60 * 60)))
  const absDays = Math.max(1, Math.round(absMs / (1000 * 60 * 60 * 24)))

  if (status === 'overdue') {
    return absHours < 24 ? `${absHours}h late` : `${absDays}d late`
  }

  if (status === 'upcoming') {
    if (diffMs <= 24 * 60 * 60 * 1000) return 'due today'
    if (diffMs <= 48 * 60 * 60 * 1000) return 'due tomorrow'
    return `in ${absDays}d`
  }

  if (diffMs <= 7 * 24 * 60 * 60 * 1000) {
    return `in ${absDays}d`
  }

  return new Date(dueIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dueStateTokens(status: KcDueStatus) {
  if (status === 'overdue') {
    return { label: 'Overdue', bg: 'red.2', border: 'red.6', fg: 'red.11' }
  }
  if (status === 'upcoming') {
    return { label: 'Due soon', bg: 'amber.2', border: 'amber.6', fg: 'amber.11' }
  }
  return { label: 'Comfortable', bg: 'green.2', border: 'green.6', fg: 'green.11' }
}

function ProgressRing(props: { value: number; max: number; size?: number }) {
  const size = () => props.size ?? 80
  const radius = () => (size() - 8) / 2
  const circumference = () => 2 * Math.PI * radius()
  const pct = () => props.max > 0 ? props.value / props.max : 0
  const offset = () => circumference() * (1 - pct())

  return (
    <svg width={size()} height={size()} viewBox={`0 0 ${size()} ${size()}`} style={{ display: 'block' }}>
      <circle
        cx={size() / 2}
        cy={size() / 2}
        r={radius()}
        fill="none"
        stroke="var(--colors-bg-subtle)"
        stroke-width="6"
      />
      <circle
        cx={size() / 2}
        cy={size() / 2}
        r={radius()}
        fill="none"
        stroke={pct() >= 0.8 ? 'var(--colors-green-9)' : pct() >= 0.4 ? 'var(--colors-yellow-9)' : 'var(--colors-blue-9)'}
        stroke-width="6"
        stroke-dasharray={String(circumference())}
        stroke-dashoffset={String(offset())}
        stroke-linecap="round"
        transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text
        x={size() / 2}
        y={size() / 2}
        text-anchor="middle"
        dominant-baseline="central"
        style={{ fill: 'var(--colors-fg-default)', 'font-size': '13px', 'font-weight': '600' }}
      >
        {props.value}/{props.max}
      </text>
    </svg>
  )
}

function DueStateBadge(props: { status: KcDueStatus; dueIso: string }) {
  const tokens = () => dueStateTokens(props.status)

  return (
    <span
      class={css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1.5',
        px: '2',
        py: '0.5',
        borderRadius: 'full',
        border: '1px solid',
        fontSize: 'xs',
        fontWeight: 'medium',
        whiteSpace: 'nowrap',
      })}
      style={{
        'background-color': `var(--colors-${tokens().bg.replace('.', '-')})`,
        'border-color': `var(--colors-${tokens().border.replace('.', '-')})`,
        color: `var(--colors-${tokens().fg.replace('.', '-')})`,
      }}
      title={new Date(props.dueIso).toLocaleString()}
    >
      <span>{tokens().label}</span>
      <span class={css({ opacity: 0.85 })}>{formatDueHint(props.dueIso, props.status)}</span>
    </span>
  )
}

function SummaryCountBadge(props: { count: number; label: string; tone: KcDueStatus }) {
  const tokens = () => dueStateTokens(props.tone)

  return (
    <span
      class={css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1.5',
        px: '2.5',
        py: '1',
        borderRadius: 'full',
        border: '1px solid',
        fontSize: 'xs',
        fontWeight: 'medium',
      })}
      style={{
        'background-color': `var(--colors-${tokens().bg.replace('.', '-')})`,
        'border-color': `var(--colors-${tokens().border.replace('.', '-')})`,
        color: `var(--colors-${tokens().fg.replace('.', '-')})`,
      }}
    >
      <span>{props.count}</span>
      <span>{props.label}</span>
    </span>
  )
}

function KcLabel(props: { kc: Pick<KcItem, 'label' | 'labelPl'> }) {
  return (
    <>
      <span class={css({ fontSize: 'sm', fontWeight: 'semibold', color: 'fg.default' })}>
        {props.kc.labelPl ?? props.kc.label}
      </span>
      <Show when={props.kc.labelPl}>
        <span class={css({ fontSize: 'xs', color: 'fg.muted' })}>({props.kc.label})</span>
      </Show>
    </>
  )
}

function KcRow(props: { kc: KcItem }) {
  const pct = () => Math.min(100, Math.max(0, props.kc.masteredPct))
  const canPractice = () => props.kc.totalCards > 0

  return (
    <div class={css({
      p: '3',
      border: '1px solid',
      borderColor: 'border',
      borderRadius: 'l2',
      bg: 'bg',
      display: 'flex',
      flexDirection: 'column',
      gap: '2',
    })}>
      <div class={css({ display: 'flex', justifyContent: 'space-between', gap: '3', alignItems: 'flex-start', flexWrap: 'wrap' })}>
        <div class={css({ display: 'flex', flexDirection: 'column', gap: '0.5' })}>
          <div class={css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })}>
            <KcLabel kc={props.kc} />
          </div>
          <div class={css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })}>
            <DueStateBadge status={props.kc.dueStatus} dueIso={props.kc.currentDue} />
          </div>
        </div>

        <Show when={canPractice()}>
          <A
            href={buildFocusedSessionHref(props.kc)}
            class={css({
              fontSize: 'xs',
              fontWeight: 'semibold',
              color: 'blue.11',
              textDecoration: 'none',
              px: '2.5',
              py: '1',
              borderRadius: 'full',
              bg: 'blue.2',
              border: '1px solid',
              borderColor: 'blue.6',
              _hover: { bg: 'blue.3' },
            })}
          >
            Practice →
          </A>
        </Show>
      </div>

      <div class={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
        <div class={css({ flex: 1, position: 'relative', height: '2.5', bg: 'bg.subtle', borderRadius: 'full', overflow: 'hidden' })}>
          <div
            class={css({ position: 'absolute', inset: 0, borderRadius: 'full', transition: 'width 0.3s ease' })}
            style={{
              width: `${pct()}%`,
              'background-color': `var(--colors-${masteryColor(props.kc.masteredPct).replace('.', '-')})`,
            }}
          />
        </div>
        <span
          class={css({ minWidth: '12', textAlign: 'right', fontSize: 'sm', fontWeight: 'semibold' })}
          style={{ color: `var(--colors-${masteryColor(props.kc.masteredPct).replace('.', '-')})` }}
        >
          {props.kc.masteredPct}%
        </span>
      </div>

      <div class={css({ display: 'flex', flexWrap: 'wrap', gap: '2', fontSize: 'xs', color: 'fg.muted' })}>
        <span>KC stability {formatStability(props.kc.currentStability)}</span>
        <span>{props.kc.totalCards} {props.kc.totalCards === 1 ? 'card' : 'cards'}</span>
        <Show when={props.kc.overdueCount > 0}>
          <span>{props.kc.overdueCount} overdue {props.kc.overdueCount === 1 ? 'card' : 'cards'}</span>
        </Show>
        <Show when={props.kc.reps > 0}>
          <span>{props.kc.reps} reviews</span>
        </Show>
      </div>
    </div>
  )
}

function LemmaKcCard(props: { kc: KcItem }) {
  return (
    <div class={css({
      display: 'flex',
      flexDirection: 'column',
      gap: '2.5',
      p: '3',
      border: '1px solid',
      borderColor: 'border',
      borderRadius: 'l2',
      bg: 'bg',
    })}>
      <div class={css({ display: 'flex', justifyContent: 'space-between', gap: '2', alignItems: 'flex-start' })}>
        <div class={css({ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1' })}>
          <span class={css({ fontSize: 'sm', fontWeight: 'semibold', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
            {props.kc.labelPl ?? props.kc.label}
          </span>
          <DueStateBadge status={props.kc.dueStatus} dueIso={props.kc.currentDue} />
        </div>
        <span
          class={css({ fontSize: 'sm', fontWeight: 'semibold', flexShrink: 0 })}
          style={{ color: `var(--colors-${masteryColor(props.kc.masteredPct).replace('.', '-')})` }}
        >
          {props.kc.masteredPct}%
        </span>
      </div>

      <div class={css({ fontSize: 'xs', color: 'fg.muted', display: 'flex', flexDirection: 'column', gap: '1' })}>
        <span>KC stability {formatStability(props.kc.currentStability)}</span>
        <span>{props.kc.totalCards} {props.kc.totalCards === 1 ? 'card' : 'cards'}</span>
      </div>

      <Show when={props.kc.totalCards > 0}>
        <A
          href={buildFocusedSessionHref(props.kc)}
          class={css({
            display: 'inline-flex',
            justifyContent: 'center',
            alignItems: 'center',
            px: '3',
            py: '1.5',
            borderRadius: 'l2',
            bg: 'blue.9',
            color: 'white',
            fontSize: 'xs',
            fontWeight: 'semibold',
            textDecoration: 'none',
            _hover: { bg: 'blue.10' },
          })}
        >
          Practice lemma KC
        </A>
      </Show>
    </div>
  )
}

function SummaryBar() {
  const [summary, { refetch }] = createResource(() => api.analytics.kcSummary({}) as Promise<KcSummary>)

  return (
    <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
      <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '4' })}><Spinner /></div>}>
        <Show
          when={summary() && summary()!.totalLemmas > 0}
          fallback={
            <Show when={summary()}>
              <div class={css({
                p: '4',
                bg: 'bg.subtle',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: 'l3',
                fontSize: 'sm',
                color: 'fg.muted',
              })}>
                No knowledge components seeded yet. Run <code class={css({ fontFamily: 'mono', bg: 'bg.muted', px: '1', borderRadius: 'sm' })}>strus kc seed</code> to populate mastery data.
              </div>
            </Show>
          }
        >
          {(() => {
            const data = () => summary()!
            const weakest = () => data().weakestKC
            return (
              <Card>
                <div class={css({ display: 'flex', alignItems: 'center', gap: '6', flexWrap: 'wrap' })}>
                  <div class={css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1' })}>
                    <ProgressRing value={data().masteredLemmas} max={data().totalLemmas} size={80} />
                    <span class={css({ fontSize: 'xs', color: 'fg.muted', textAlign: 'center' })}>
                      lemmas mastered
                    </span>
                  </div>

                  <div class={css({ flex: 1, minWidth: '18rem', display: 'flex', flexDirection: 'column', gap: '2' })}>
                    <div>
                      <h2 class={css({ fontSize: 'xl', fontWeight: 'bold', color: 'fg.default', mb: '1' })}>
                        {data().masteredLemmas} / {data().totalLemmas} lemmas mastered
                      </h2>
                      <p class={css({ fontSize: 'sm', color: 'fg.muted' })}>
                        {data().totalDueCards} cards due across {data().totalStructural} structural KCs
                      </p>
                    </div>

                    <div class={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                      <SummaryCountBadge count={data().structuralDueStates.overdue} label="overdue KCs" tone="overdue" />
                      <SummaryCountBadge count={data().structuralDueStates.upcoming} label="due soon" tone="upcoming" />
                      <SummaryCountBadge count={data().structuralDueStates.scheduled} label="comfortable" tone="scheduled" />
                    </div>

                    <Show when={weakest()}>
                      {(kc) => (
                        <div class={css({
                          display: 'inline-flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: '2',
                          px: '3',
                          py: '2',
                          bg: 'orange.2',
                          border: '1px solid',
                          borderColor: 'orange.6',
                          borderRadius: 'l2',
                        })}>
                          <span class={css({ fontSize: 'xs', color: 'orange.11', fontWeight: 'semibold' })}>🎯 Weakest KC</span>
                          <span class={css({ fontSize: 'sm', fontWeight: 'medium', color: 'orange.11' })}>
                            {kc().labelPl ?? kc().label}
                            <Show when={kc().labelPl}>
                              <span class={css({ fontWeight: 'normal', ml: '1', color: 'orange.9' })}>({kc().label})</span>
                            </Show>
                          </span>
                          <span class={css({ fontSize: 'xs', color: 'orange.10' })}>KC stability {formatStability(kc().currentStability)}</span>
                          <DueStateBadge status={kc().dueStatus} dueIso={kc().currentDue} />
                        </div>
                      )}
                    </Show>
                  </div>

                  <div class={css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2' })}>
                    <Show
                      when={weakest()}
                      fallback={
                        <>
                          <button
                            type="button"
                            disabled
                            class={css({
                              display: 'inline-flex',
                              alignItems: 'center',
                              px: '4',
                              py: '2',
                              bg: 'bg.muted',
                              color: 'fg.muted',
                              borderRadius: 'l2',
                              fontSize: 'sm',
                              fontWeight: 'semibold',
                              border: '1px solid',
                              borderColor: 'border',
                              cursor: 'not-allowed',
                              opacity: 0.7,
                            })}
                          >
                            ▶ Practice weakest KC
                          </button>
                          <span class={css({ fontSize: 'xs', color: 'fg.muted', maxWidth: '16rem' })}>
                            Focused KC practice appears once structural KCs have linked cards.
                          </span>
                        </>
                      }
                    >
                      {(kc) => (
                        <A
                          href={buildFocusedSessionHref(kc())}
                          class={css({
                            display: 'inline-flex',
                            alignItems: 'center',
                            px: '4',
                            py: '2',
                            bg: 'blue.9',
                            color: 'white',
                            borderRadius: 'l2',
                            fontSize: 'sm',
                            fontWeight: 'semibold',
                            textDecoration: 'none',
                            _hover: { bg: 'blue.10' },
                            transition: 'background 0.15s',
                          })}
                        >
                          ▶ Practice weakest KC
                        </A>
                      )}
                    </Show>
                  </div>
                </div>
              </Card>
            )
          })()}
        </Show>
      </Suspense>
    </ErrorBoundary>
  )
}

function CaseMasterySection() {
  const [cases, { refetch }] = createResource(() => api.analytics.kcMastery({ kind: 'case', sort: 'weakest' }) as Promise<KcItem[]>)

  return (
    <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
      <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '4' })}><Spinner /></div>}>
        <Card title="Case mastery">
          <Show
            when={(cases() ?? []).length > 0}
            fallback={
              <p class={css({ fontSize: 'sm', color: 'fg.muted', py: '2' })}>
                No case data yet. Run <code class={css({ fontFamily: 'mono', bg: 'bg.muted', px: '1', borderRadius: 'sm' })}>strus kc seed</code>.
              </p>
            }
          >
            <div class={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
              <For each={cases()}>{(kc) => <KcRow kc={kc} />}</For>
            </div>
          </Show>
        </Card>
      </Suspense>
    </ErrorBoundary>
  )
}

function DimensionSection(props: { kind: string; title: string }) {
  const [items, { refetch }] = createResource(
    () => props.kind,
    (kind) => api.analytics.kcMastery({ kind: kind as 'number' | 'gender' | 'tense' | 'mood' | 'pos', sort: 'weakest' }) as Promise<KcItem[]>,
  )
  const [open, setOpen] = createSignal(false)
  const toggle = () => setOpen((value) => !value)

  return (
    <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
      <div class={css({ border: '1px solid', borderColor: 'border', borderRadius: 'l2', overflow: 'hidden' })}>
        <button
          type="button"
          onClick={toggle}
          class={css({
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            px: '4',
            py: '3',
            bg: 'bg.subtle',
            border: 'none',
            cursor: 'pointer',
            _hover: { bg: 'bg.muted' },
            transition: 'background 0.1s',
          })}
        >
          <span class={css({ fontSize: 'sm', fontWeight: 'semibold', color: 'fg.default' })}>{props.title}</span>
          <span class={css({ fontSize: 'xs', color: 'fg.muted' })}>{open() ? '▲' : '▼'}</span>
        </button>
        <Show when={open()}>
          <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '3' })}><Spinner /></div>}>
            <div class={css({ px: '4', py: '3' })}>
              <Show
                when={(items() ?? []).length > 0}
                fallback={<p class={css({ fontSize: 'sm', color: 'fg.muted', py: '2' })}>No data.</p>}
              >
                <div class={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                  <For each={items()}>{(kc) => <KcRow kc={kc} />}</For>
                </div>
              </Show>
            </div>
          </Suspense>
        </Show>
      </div>
    </ErrorBoundary>
  )
}

function LemmaProgressSection() {
  const [lemmas, { refetch }] = createResource(() => api.analytics.kcMastery({ kind: 'lemma', sort: 'weakest', limit: 24 }) as Promise<KcItem[]>)

  return (
    <ErrorBoundary fallback={(err) => <ErrorState message={String(err)} onRetry={refetch} />}>
      <Suspense fallback={<div class={css({ display: 'flex', justifyContent: 'center', py: '4' })}><Spinner /></div>}>
        <Card title="Lemma FSRS state">
          <Show
            when={(lemmas() ?? []).length > 0}
            fallback={
              <p class={css({ fontSize: 'sm', color: 'fg.muted', py: '2' })}>
                No lemma data yet. Run <code class={css({ fontFamily: 'mono', bg: 'bg.muted', px: '1', borderRadius: 'sm' })}>strus kc seed</code>.
              </p>
            }
          >
            <div class={css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '3' })}>
              <For each={lemmas()}>{(kc) => <LemmaKcCard kc={kc} />}</For>
            </div>
          </Show>
        </Card>
      </Suspense>
    </ErrorBoundary>
  )
}

export function KcDashboard() {
  return (
    <div class={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
      <SummaryBar />
      <CaseMasterySection />

      <Card title="Dimensions">
        <div class={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
          <For each={DIMENSION_KINDS}>
            {(dim) => <DimensionSection kind={dim.kind} title={dim.label} />}
          </For>
        </div>
      </Card>

      <LemmaProgressSection />
    </div>
  )
}
