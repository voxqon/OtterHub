# OtterHub Storage Simulation

Created 2026-10-28 from the Telegram subset in `postman/telegram.openapi.yaml`.
The CLI was signed out, so the provider-owner mock search was skipped; the local
handler follows that public contract and uses explicit test fixtures.

## Purpose

Exercise OtterHub's real Telegram adapter over HTTP, including retries, chunk
completion, byte ranges, download caching and permanent chat-message deletion.
Fixture behavior and local test controls live in `../mocks/telegram/default.js`.

## Execution

Use Node.js 20.9+ and Postman CLI 1.70+.

```powershell
postman simulation run postman/simulations/otterhub-storage.sim.yaml --port 4900 --output ndjson --no-history
# In another terminal:
$env:TG_SIM_URL = "http://localhost:4900/telegram"
npm test
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

2026-11-16 (scoped chunk uploads and key retrieval): The 68-test run passed
against the existing Telegram HTTP member on port 4901 (CLI 1.75.0). Request
events confirmed that the scoped API's chunk storage, private download and
permanent deletion reached sendDocument, getFile, the file path and deleteMessage.
The mock still serves four-byte fixtures, so this does not establish live
Telegram upload limits. In a separate isolated Wrangler KV/R2 run, the downloadable
`frontend/public/examples/file-api-upload.mjs` transferred an actual 1,048,576,000
byte file in 50 chunks, was interrupted after the first confirmed chunk and
resumed using its local state, then completed. The complete download matched
the input SHA-256 `dce392d2721630ce889a73b5fe0b405748ebedf627cc57b6f457cb67e2ab5a66`.
Private access, cross-chunk Range, permanent deletion, encrypted administrator
key retrieval and plaintext-free status responses passed locally. Browser checks
also confirmed documentation navigation, mobile layout, key generation,
status refresh, retrieval of the same key, masking and reset to a different key.
This is local R2 and simulated Telegram evidence, not production deployment,
geographic KV consistency or live bot delivery evidence.

2026-11-16 (scoped file API): Reused the existing Telegram member with CLI
1.75.0 on local port 4901. The 61-test run passed with `TG_SIM_URL` set;
`test/file-api.test.js` exercised the actual `/api/v1/files` routes through
sendDocument, getFile, content download and deleteMessage. Request events and
the fixture state confirmed that the uploaded private file was read and its
message deleted before its KV index disappeared. Telegram was the only member
and served all relevant calls. This establishes caller behavior against the
existing four-byte fixture, not live bot permissions, message ages, upload
limits or geographic KV consistency. A separate isolated Wrangler KV/R2 run
verified upload, listing, private download, byte ranges, metadata updates,
trash, permanent deletion, permission scopes, token rotation and revocation.

2026-10-28 (duplicate uploads): Telegram, the only member, served both uploads
returning the same file ID and both subsequent deletions in the passing 50-test
run. Normal uploads, chunks, imported notices and failure retries also reached
the HTTP mock; no member was silent.

2026-10-28 (chat deletion and languages): Telegram, the only member, served
sendDocument, sendMessage, deleteMessage, getFile and downloads in the passing
49-test run. Request events confirmed permission and age failures, partial-delete
retries and imported-message cleanup reached the HTTP mock; no member was silent.
Live bot permissions and actual Telegram message ages remain unverified.

2026-10-28 (logic and access regressions): Telegram, the only member, served
upload, file-path lookup and byte-range download traffic during the combined
Mocha run against an isolated Wrangler KV/R2 instance. The simulation's request
events confirmed the retry and download paths still reached the HTTP mock after
the authentication, trash and share fixes; no member was silent.

2026-10-28: Telegram, the only simulation member, served actual upload, getFile
and download traffic. The suite verified 429 and HTML 502 recovery, no retry for
400/401, shared file-path lookups, and exact byte ranges across two chunks.

<!-- end:observations -->

## What didn't work

- 2026-10-28: initial deletion checks sent an empty parsed payload because the
  handler re-read the stream with `interceptRequests: true`; this CLI supplies
  JSON through `req.body`. Correcting the handler restored the passing HTTP run.
