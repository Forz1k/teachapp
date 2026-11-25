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
- Maximum 1 MiB per PUT, one anchor plus 128 changes, 16 MiB ledger. Reaching the cap stops ordinary writes; explicit privileged compaction is available if a complete anchor fits.
- Only the authenticated client can interpret or validate encrypted content. The server checks envelope shape, bounds, authorization and sequence.
- The real local workerd test uses two scoped devices, races writes, restarts the worker, fetches a contiguous chain and reconstructs the full snapshot with the client codec. This is not a production migration or a normal application sync option.

## Explicit compaction and test client
`TEACHAPP_DELTA_COMPACT_HASHES` is an optional JSON object of separate per-area SHA-256 token hashes (must not equal ordinary access hashes). A compactor token cannot read or append, and an ordinary token cannot compact. The synthetic client uses both credentials only in memory and accepts HTTP loopback endpoints only.

The client reconstructs the remote state (not dirty local data), verifies the workspace, each revision, relationships and any retained local checkpoint, then encrypts a complete anchor at the next revision. Explicit confirmation and expected head revision are required. The Worker atomically inserts the anchor and removes superseded revisions using CAS; concurrent append and compaction cannot both succeed. Old revision requests return 410 and bounded readers restart from the new anchor. An exact retry is accepted while that anchor is the latest revision. After compaction, a fresh device reads the new anchor plus later deltas; an offline device with an older checkpoint keeps its own base and must reconcile explicitly. A checkpoint older than the retained anchor cannot independently verify the removed chain, and is marked as such. No local records are written by the LAB helpers.

This is a **trusted-client** operation: the opaque server cannot prove that a privileged writer's ciphertext contains the same state. Keep a verified encrypted backup before compaction; the prototype does not provide an immutable historical audit or Byzantine protection. No automatic compaction or normal sync integration, no chunked anchors above 1 MiB, no production deployment.

## Existing sync pipeline (synthetic integration)
`deltaLabSyncAdapter` requires explicit synthetic opt-in, injected data access and a loopback server. It implements the existing get/put interface: normal `prepareSync`, `previewSync` and `executeSync` retain scoped checkpoints and conflict/relationship validation. The full envelope returned to the existing pipeline is assembled and encrypted locally, never transmitted as an update. An initial anchor is sent once, later writes contain only changed records, and pulls use `reuseRemote:true` to avoid unnecessary revisions. A verified checkpoint checks the matching authenticated server entry and downloads only its tail. A compacted-away checkpoint requires explicit review opt-in before the existing three-way merge; it is not silently accepted.

The real workerd harness exercises two independent synthetic IndexedDB databases, edits to different records, a conflict with explicit resolution, and recovery after compaction. No ordinary UI or background auto-sync is connected to this adapter. The current implementation does not yet optimize the local full-envelope encryption cost, rotate encryption keys, handle chunked large anchors, or authorize a production migration.
