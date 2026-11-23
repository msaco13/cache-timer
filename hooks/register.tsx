import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { CacheMark, Ttl } from '../types'

// Last main-thread request that read or wrote the prompt cache.
const mark = atom({ plugin: 'cache-timer', key: 'mark' } as const, null, { shape: 'mark-1' })
// `at` of the mark we already warned about, so the warning fires once per window.
const warnedAt = atom({ plugin: 'cache-timer', key: 'warnedAt' } as const, 0)

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Redraw the band every second and check whether to warn.
    $.clock.every(1000, async () => {
      $.ui.invalidate('ui.render')
      const m = await read($, mark)
      if (!m) return
      const left = m.at + TTL_MS[m.ttl] - (await $.clock.now())
      if (left > 0 && left <= warnLeadMs(m.ttl) && (await read($, warnedAt)) !== m.at) {
        await update($, warnedAt, () => m.at)
        const text = `Prompt cache goes cold in ${clockText(left)}. Send a message to keep it warm.`
        $.ui.toast(text, { timeoutMs: 15_000 })
        void $.ui.notify(text, { title: 'Cache warning' }).catch(() => undefined)
      }
    })
    return next(e)
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
        await update($, mark, prev => {
          const ttl: Ttl = seen ?? prev?.ttl ?? '1h'
          const fresh: CacheMark = { at: sentAt, ttl, ttlKnown: seen !== null || (prev?.ttlKnown ?? false) }
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

    if (!m) {
      return (
        <Box>
          <Text dimColor>Cache: no cached request yet</Text>
        </Box>
      )
    }

    const left = m.at + TTL_MS[m.ttl] - (await $.clock.now())
    const ttlLabel = `${m.ttl} TTL${m.ttlKnown ? '' : '?'}`

    if (e.props.isWorking) {
      return (
        <Box>
          <Text color="success" weight="bold">● Cache WARM</Text>
          <Text dimColor>  in use, refreshes when this turn's requests land ({ttlLabel})</Text>
        </Box>
      )
    }

    if (left <= 0) {
      return (
        <Box>
          <Text color="error" weight="bold">● Cache COLD</Text>
          <Text dimColor>  expired {clockText(-left)} ago. Next message re-writes the full context.</Text>
        </Box>
      )
    }

    const isWarning = left <= warnLeadMs(m.ttl)
    return (
      <Box>
        <Text color={isWarning ? 'warning' : 'success'} weight="bold">
          ● Cache WARM
        </Text>
        <Text color={isWarning ? 'warning' : undefined} tabular>
          {'  '}{clockText(left)} left
        </Text>
        <Text dimColor>  ({ttlLabel}){isWarning ? '  going cold soon' : ''}</Text>
      </Box>
    )
  })
}
