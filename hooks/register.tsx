import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { CacheMark, Ttl } from '../types'
import { recacheCost, usd } from './pricing'

// Last main-thread request that read or wrote the prompt cache.
const mark = atom({ plugin: 'cache-timer', key: 'mark' } as const, null, { shape: 'mark-2' })
// `at` of the mark we already warned about, so the warning fires once per window.
const warnedAt = atom({ plugin: 'cache-timer', key: 'warnedAt' } as const, 0)
// Compact band: dot and time only. Mirrored to $.store so it sticks across sessions.
const compact = atom({ plugin: 'cache-timer', key: 'compact' } as const, false)

const TTL_MS: Record<Ttl, number> = { '5m': 300_000, '1h': 3_600_000 }
// Warn 5 minutes out on a 1h cache; on a 5m cache that would be instant, so warn at 1 minute.
const warnLeadMs = (ttl: Ttl) => (ttl === '1h' ? 300_000 : 60_000)

function ttlFrom(usage: TurnUsage): Ttl | null {
  const m5 = usage.ephemeral_5m_input_tokens ?? 0
  const h1 = usage.ephemeral_1h_input_tokens ?? 0
  if (m5 > 0) return '5m' // shorter wins when both were written
  if (h1 > 0) return '1h'
  return null
}

function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function costText(m: CacheMark, isCold: boolean): string {
  const c = recacheCost(m.model, m.tokens, m.ttl)
  if (!c) return ''
  const k = Math.round(m.tokens / 1000)
  return isCold
    ? `  next msg re-caches ${k}K tokens ≈ ${usd(c.cold)} (vs ${usd(c.warm)} warm, est.)`
    : `  ${k}K ctx: ${usd(c.warm)} warm / ${usd(c.cold)} if cold (est.)`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache-timer',
      description: 'Cache band: compact (dot and time) or full (with cost estimate)',
      argumentHint: '[compact|full]',
    })
    const saved = await $.store.get('compact')
    if (typeof saved === 'boolean') await update($, compact, () => saved)

    // Redraw the band every second and check whether to warn.
    $.clock.every(1000, async () => {
      $.ui.invalidate('ui.render')
      const m = await read($, mark)
      if (!m) return
      const left = m.at + TTL_MS[m.ttl] - (await $.clock.now())
      if (left > 0 && left <= warnLeadMs(m.ttl) && (await read($, warnedAt)) !== m.at) {
        await update($, warnedAt, () => m.at)
        const c = recacheCost(m.model, m.tokens, m.ttl)
        const cost = c
          ? ` Going cold makes the next message cost ≈ ${usd(c.cold)} instead of ${usd(c.warm)} (est.).`
          : ''
        const text = `Prompt cache goes cold in ${clockText(left)}.${cost} Send a message to keep it warm.`
        $.ui.toast(text, { timeoutMs: 15_000 })
        void $.ui.notify(text, { title: 'Cache warning' }).catch(() => undefined)
      }
    })
    return next(e)
  })

  on('command.run', { command: 'cache-timer' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const want = arg === 'compact' ? true : arg === 'full' ? false : !(await read($, compact))
    await update($, compact, () => want)
    await $.store.set('compact', want)
    return { text: `Cache band: ${want ? 'compact' : 'full'}.` }
  })

  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now() // cache lifetime counts from the request's start
    const result = yield* next(e)
    const usage = result.usage
    if (e.agentId === undefined && usage) {
      const wrote = usage.cache_creation_input_tokens > 0
      const readHit = usage.cache_read_input_tokens > 0
      if (wrote || readHit) {
        const seen = ttlFrom(usage)
        const tokens =
          usage.input_tokens +
          usage.cache_read_input_tokens +
          usage.cache_creation_input_tokens +
          usage.output_tokens
        await update($, mark, prev => {
          const ttl: Ttl = seen ?? prev?.ttl ?? '1h'
          const fresh: CacheMark = {
            at: sentAt,
            ttl,
            ttlKnown: seen !== null || (prev?.ttlKnown ?? false),
            tokens,
            model: usage.model,
          }
          return fresh
        })
      }
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const m = await read($, mark)
    const isCompact = await read($, compact)

    if (!m) {
      return (
        <Box>
          <Text dimColor>{isCompact ? '○ --:--' : 'Cache: no cached request yet'}</Text>
        </Box>
      )
    }

    const left = m.at + TTL_MS[m.ttl] - (await $.clock.now())
    const isCold = left <= 0
    const isWarning = !isCold && left <= warnLeadMs(m.ttl)
    const color = e.props.isWorking ? 'success' : isCold ? 'error' : isWarning ? 'warning' : 'success'

    if (isCompact) {
      const label = e.props.isWorking ? 'in use' : isCold ? 'cold' : clockText(left)
      return (
        <Box>
          <Text color={color} tabular>
            ● {label}
          </Text>
        </Box>
      )
    }

    const ttlLabel = `${m.ttl} TTL${m.ttlKnown ? '' : '?'}`

    if (e.props.isWorking) {
      return (
        <Box>
          <Text color="success" weight="bold">
            ● Cache WARM
          </Text>
          <Text dimColor>  in use, refreshes as this turn's requests land ({ttlLabel})</Text>
        </Box>
      )
    }

    if (isCold) {
      return (
        <Box>
          <Text color="error" weight="bold">
            ● Cache COLD
          </Text>
          <Text dimColor>
            {'  '}expired {clockText(-left)} ago.{costText(m, true)}
          </Text>
        </Box>
      )
    }

    return (
      <Box>
        <Text color={color} weight="bold">
          ● Cache WARM
        </Text>
        <Text color={isWarning ? 'warning' : undefined} tabular>
          {'  '}
          {clockText(left)} left
        </Text>
        <Text dimColor>
          {'  '}({ttlLabel}){isWarning ? '  going cold soon' : ''}
          {costText(m, false)}
        </Text>
      </Box>
    )
  })
}
