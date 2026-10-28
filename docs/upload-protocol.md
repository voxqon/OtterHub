# Confirmed chunk uploads

Existing `POST /upload/chunk/init` and numeric `POST /upload/chunk` responses remain
supported. New clients use this sequence:

1. `POST /upload/chunk/init` with `fileType`, `fileName`, `fileSize`,
   `totalChunks`, and optional `tags`. The response data is the file key.
   `totalChunks` must equal `ceil(fileSize / MAX_CHUNK_SIZE)`.
2. `POST /upload/chunk` as multipart form data with `key`, `chunkIndex`,
   `chunkFile`, and `returnReceipt=true`. A successful response has data
   `{ chunkIndex, receipt }` and confirms that storage accepted the chunk.
   Each non-final chunk must be exactly 20 MiB; the final chunk must match the
   remaining declared bytes. Each chunk has an independent KV receipt.
3. `POST /upload/chunk/complete` with JSON `{ key, receipts: string[] }`.
   The server verifies signed receipts, their file key and expiry, contiguous
   indices, and exact sizes before writing the parent manifest. The response data
   is the completed `FileMetadata`, including tags and uploaded indices. Completion
   can be repeated. Normal uploads need no progress polling.

All upload routes require the existing cookie or API token authentication.
Receipts use `JWT_SECRET`, are scoped to chunk completion, and expire after one
hour. An expired or forged receipt returns 400. Storage failures return 503.
The client does not automatically repeat mutation requests after network errors.
Single-file and chunk uploads share two browser upload slots, including resume
operations, so selecting several large files cannot multiply chunk concurrency.

For resume, `GET /upload/chunk/progress?key=...` returns
`{ uploadedIndices, uploaded, total, complete, receipts }`. The client uploads
missing indices and submits the recovered and new receipts to `/chunk/complete`.
Legacy asynchronous uploads can also be finalized by this progress read.
Incomplete upload sessions and their receipts expire after one hour; completed
parent records have no expiration.

KV remains eventually consistent across locations. Signed receipts let completion
avoid immediately rereading every chunk receipt, but new parent records and resume
progress can still take time to propagate. Concurrent duplicate chunk requests are
coalesced within a reused adapter; KV provides no global lock or exactly-once
Telegram send guarantee. Cross-location duplicate sends and interrupted requests
whose receipt was not persisted still require reconciliation.

File lists refresh on returning to the tab, reconnecting, or switching file type,
with a 15-second freshness window. A 65-second local mutation overlay prevents
stale list responses from undoing recent uploads, edits and deletes. This is
event-triggered refresh, not a server push subscription.
