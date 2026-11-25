# Candidate archive migration (8.2)

Production config `firebase.json` and `firebase-portal.rules.json` are unchanged. Candidate uses `firebase-archive-dev.json` with `firebase-portal-v2.rules.json`. Do not deploy before emulator success and owner approval. New path is `publicMatchArchive/{uid}/{slug}/{timestamp_id}`, separate from live score and old 20-result projection. Explicit publishing of score-only records via ETag conditional write. Public reads require existing published parent, list queries must be ordered by key and bounded to 42 records, single-result reads are direct. Unpublishing the parent hides archive but retains records. Republishing can reveal retained records; delete/sanitization procedure must be approved before production.

Run emulator using workflow or equivalent command. Copy existing results only by explicit confirmation, don't export local private matches in bulk. Keep old public URL working. Test with synthetic accounts, 45 matches, guest bounded pagination, denial of private fields and foreign writers, stale revisions and removal. Existing legacy data is not changed by adding a new path. No real data migration performed.

Remaining: server validation of key/body equality and score consistency, full historical detailed event schema, physical-device acceptance and approved migration of actual published data. Candidate rules are not a release.

## Owner archive manager

The owner can list bounded pages, open permanent links, copy already-published recent results without replacing any existing record, and explicitly remove an extended result with ETag protection. Legacy and extended result removals remain independent. The public results screen supports September–August UTC season filtering for loaded rows only. Production deployment is still not authorized.

## Public media center (9.3–9.4)

Candidate rules also implement `publicMedia/{uid}/{slug}`, separate from the live heartbeat. Up to 20 explicitly published news records and one tournament projection (up to 32 teams, 500 matches) are supported. Private drafts remain in IndexedDB; the public reader has no dependency on the draft or private tournament modules. The publisher uses conditional ETag writes. The parent portal must be published to read the media record. Removal of the parent hides retained content, which can become visible again after republication; review and remove stale records explicitly before republishing. Referee names and private identifiers are not exported. The candidate does not include photo/video hosting or fan voting. Authors must not publish students' personal or sensitive data in free text. Production rules were not changed.

Emulator tests cover owner/foreign/guest permissions, limits, unknown fields, invalid results, stale ETags and removal. A real migration and publication require separate owner approval.

## 5.5 stage 1 — direct season browsing

The spectator may query a UTC September–August season by its starting year, including a year absent from the latest 20 matches. Both key bounds and the cursor are validated; each query remains bounded to at most 42 records. Changing seasons invalidates in-flight page responses. Legacy recent results are still merged and filtered; summaries and search cover only loaded data. No production rules, publication or migration changed.
