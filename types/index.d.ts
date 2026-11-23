export type Ttl = '5m' | '1h'
export type CacheMark = { at: number; ttl: Ttl; ttlKnown: boolean }

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': { mark: Shaped<CacheMark | null>; warnedAt: number }
  }
}
