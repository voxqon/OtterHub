# OtterHub Storage Simulation

Created 2026-10-28 from the Telegram subset in `postman/telegram.openapi.yaml`.
The CLI was signed out, so the provider-owner mock search was skipped; the local
handler follows that public contract and uses explicit test fixtures.

## Purpose

Exercise OtterHub's real Telegram adapter over HTTP, including retry decisions,
chunk completion, byte ranges and download lookup caching. Fixture behavior and
local test controls live in `../mocks/telegram/default.js`.

## Execution

Use Node.js 20.9+ and Postman CLI 1.70+.

```powershell
postman simulation run postman/simulations/otterhub-storage.sim.yaml --port 4900 --output ndjson --no-history
# In another terminal:
$env:TG_SIM_URL = "http://localhost:4900/telegram"
npm run test:optimization
# Ctrl+C stops the simulation.
```

The simulation must print its `listening` event before tests run. Its subsequent
`request` events establish that the real adapter reached the mock. Without
`TG_SIM_URL`, the tests explicitly skip the Telegram HTTP group.

## Assumptions

- The handler seeds small download bodies, not Telegram's media storage or timing.
  Passing tests cannot establish production latency, geographic KV consistency or
  exactly-once Telegram delivery. (reasoned 2026-10-28, `default.js`)
- Tests use a local in-memory KV for adapter checks. The separate `test/test.js`
  suite exercises real Wrangler KV/R2 bindings and a file larger than 20 MiB.
  (observed 2026-10-28)
- This CLI's `pm.state.get` and `pm.state.set` are asynchronous and must be awaited.
  Otherwise the handler fails and later requests get `502 Proxy error`.
  (observed 2026-10-28)

## Observations

<!-- begin:observations -->

2026-10-28 (logic and access regressions): Telegram, the only member, served
upload, file-path lookup and byte-range download traffic during the combined
Mocha run against an isolated Wrangler KV/R2 instance. The simulation's request
events confirmed the retry and download paths still reached the HTTP mock after
the authentication, trash and share fixes; no member was silent.

2026-10-28: Telegram, the only simulation member, served actual upload, getFile
and download traffic. The suite verified 429 and HTML 502 recovery, no retry for
400/401, shared file-path lookups, and exact byte ranges across two chunks.

<!-- end:observations -->
