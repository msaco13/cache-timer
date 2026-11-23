# cache-timer

A Claude Code mod that adds a one-line band above your prompt box showing whether the prompt cache is warm or cold and how much time is left before it expires.

- **Cache WARM** (green) with a live countdown, for example `50:00 left (1h TTL)`.
- **Going cold soon** (amber): 5 minutes before a 1-hour cache expires (1 minute before a 5-minute cache), the band turns amber and you get a toast plus a native notification, once per cache window.
- **Cache COLD** (red) with how long ago it expired, so you know the next message re-writes the full context.
- While Claude is working, the band shows the cache as in use.

The countdown starts at each main-thread request that read or wrote the cache, using the lifetime (5m or 1h) the API reports. It is an estimate: the server can evict earlier, and background requests can renew the cache without the mod seeing them. A `?` after the TTL means the lifetime was assumed, not reported.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cache-timer --marketplace msaco13/cache-timer
```

Answer `y` to add the marketplace, then pick the **user** scope so it loads in every session.

From a shell:

```bash
claude plugin install cache-timer --marketplace msaco13/cache-timer
```

## License

MIT
