export type Ttl = '5m' | '1h'
export type CacheMark = {
  at: number
  ttl: Ttl
  ttlKnown: boolean
  /** Prompt tokens the next request re-sends. */
  tokens: number
  /** Model id the API reported for the last request. */
  model: string
}

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': { mark: Shaped<CacheMark | null>; warnedAt: number; compact: boolean }
  }
}
