# Incremental sync — isolated candidate, not production

The current v1/v2 relays and automatic synchronization remain unchanged. This checkpoint adds a client-side delta codec and an explicitly labelled comparison in the manual preview. It does not send delta packets to the existing endpoints.

- A delta contains only per-store upserts and deleted IDs, with exact area, workspace, base and next revision, schema version, SHA-256 digests of canonical base/result, and the existing authenticated encryption envelope.
- Replay requires a verified base and a contiguous chain; it rejects unknown stores, duplicate or missing deletions, wrong scope, malformed records, incorrect digests, invalid relationships and wrong passwords. It never writes IndexedDB. A caller must supply a current full database to validate reconstructed scope and preserve other areas.
- The displayed estimate compares encrypted PUT sizes, including UTF-8, GCM tag and base64; the current full snapshot is still the actual payload.
- SHA-256 digests are encrypted inside each packet. They are not server-side authorization. A future isolated relay needs scoped credentials, CAS, bounded storage/paging, a durable full anchor, compaction and a safe initial download, then real multi-device and rollback tests. Production migration is explicitly out of scope.
- Maximum replay chain in this checkpoint: 128 entries. No fallback to an unverified base or deletion of local records.

## Synthetic durable relay
`wrangler.delta-dev.jsonc` defines a separate, loopback-only Worker with no public routes or binding to the live snapshot service. Explicit synthetic flag, loopback origin, and separate scoped test token hashes are required. Each scope uses an independent SQLite Durable Object.
- GET head, GET one revision, PUT initial anchor, PUT append. Writes use transactional expected-revision CAS; an exact retry of the last accepted ciphertext is idempotent. No overwrite or automatic history deletion.
- Maximum 1 MiB per PUT, one anchor plus 128 changes, 16 MiB ledger. Reaching the cap stops writes; there is deliberately no automatic compaction yet.
- Only the authenticated client can interpret or validate encrypted content. The server checks envelope shape, bounds, authorization and sequence.
- The real local workerd test uses two scoped devices, races writes, restarts the worker, fetches a contiguous chain and reconstructs the full snapshot with the client codec. This is not a production migration or a normal application sync option.
