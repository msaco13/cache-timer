// USD per million tokens, Anthropic first-party list prices (Claude API pricing
// as of 2026-11-03). Cache writes: 1.25x input for 5m, 2x input for 1h.
// Cache reads differ by model. Longest matching prefix wins.
type Rate = { input: number; read: number }

const RATES: Record<string, Rate> = {
  'claude-fable-5-2': { input: 8, read: 0.2 },
  'claude-mythos-5-2': { input: 8, read: 0.2 },
  'claude-fable-5-1': { input: 10, read: 0.25 },
  'claude-mythos-5-1': { input: 10, read: 0.25 },
  'claude-fable-5': { input: 10, read: 1 },
  'claude-mythos-5': { input: 10, read: 1 },
  'claude-opus-5-5': { input: 4, read: 0.2 },
  'claude-opus-5': { input: 5, read: 0.5 },
  'claude-opus-4-8': { input: 5, read: 0.5 },
  'claude-opus-4-7': { input: 5, read: 0.5 },
  'claude-opus-4-6': { input: 5, read: 0.5 },
  'claude-sonnet-5-5': { input: 2, read: 0.1 },
  'claude-sonnet-5': { input: 2, read: 0.2 },
  'claude-sonnet-4-6': { input: 3, read: 0.3 },
  'claude-haiku-5-5': { input: 0.1, read: 0.01 },
  'claude-haiku-4-5': { input: 1, read: 0.1 },
}

const KEYS = Object.keys(RATES).sort((a, b) => b.length - a.length)

export function rateFor(model: string): Rate | null {
  const id = model.replace(/^(us\.)?anthropic\./, '')
  const key = KEYS.find(k => id.startsWith(k))
  return (key && RATES[key]) || null
}

/** Estimated USD to resend `tokens` warm (cache read) and cold (cache write). */
export function recacheCost(model: string, tokens: number, ttl: '5m' | '1h') {
  const rate = rateFor(model)
  if (!rate || tokens <= 0) return null
  const m = tokens / 1_000_000
  return { warm: m * rate.read, cold: m * rate.input * (ttl === '1h' ? 2 : 1.25) }
}

export function usd(n: number): string {
  if (n < 0.01) return '<$0.01'
  return n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`
}
