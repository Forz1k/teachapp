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

## 5.5 stages 2–6 — persistent result queue and historical viewer

Opt-in local outbox queues only explicitly published scores, including finished LIVE and manually published recent matches. No automatic remote writes: after parent synchronization the owner confirms the pending batch. Each score-only entry is written conditionally, exact retries acknowledge existing records, differing records or same ID under another date stay unresolved; disabling queue/publication, accepting remote state or removing a recent result clears corresponding pending entries. Existing remote archive entries are independent; parent removal hides but does not erase them. No tokens, private player data or raw events are queued. A local device must keep its storage; the queue is not a cross-device or background delivery guarantee.

Legacy match links can resolve through a bounded exact-ID index; ambiguous IDs are rejected. Permanent links use original timestamp keys. Historical pages contain exact score/sets/point differential and loaded head-to-head history; no invented rally timelines, playing time, names or individual stats. Candidate rules constrain key/body equality, integer scores, continuous set indexes, non-tied sets, exact set totals and bounded indexed lookups. Production rules remain unchanged; explicit migration and physical-device acceptance required.

The exact-ID lookup protects normal sequential operations; independent clients can race when correcting the same ID to different timestamps. The viewer fails closed if an ID lookup returns two rows, while direct timestamp links stay valid. Resolve duplicates explicitly. Outbox consent and storage are device-local; simultaneous tabs should not operate the same publisher.

5.8: все операции изменения расширенного архива теперь сериализуются в одной вкладке, включая диалоги подтверждения. Это не глобальный серверный индекс уникальности и не гарантия для разных устройств/вкладок.

## 6.7 — V3 archive candidate

Separate path `publicMatchArchiveV3/{uid}/{slug}/{id}` uses immutable public ID as primary key and validated `sortKey=timestamp_id` for chronological pagination. Date corrections target the same ETag-protected record; independent writers cannot create two different keys for one ID. Candidate rules retain V2/live paths, owner-only writes and score-only validation. Client helpers and read-only migration planning exclude ambiguous IDs pending explicit resolution. V3 is not enabled in the production publisher or viewer. Before switching verify complete source pagination, copy under maintenance, reconcile links, validate counts and backups, retain V2 for rollback. Production config unchanged.

### Предпросмотр миграции V3

`inspectArchiveV3Migration` — только чтение, без авторизации/записи, до 5000 записей на путь, страницы до 41 записи. Строго проверяет ключи, состав и границу страницы, повторно сканирует оба пути и отказывается при изменении. Выдаёт список готовых к копированию записей, совпадающих ID, конфликтов дат в источнике, различающихся результатов и записей только в V3. Это не гарантия согласованности при параллельной публикации: рабочую миграцию выполнять только после отдельного серверного барьера и проверки резервной копии. Никакой автоматической записи или переключения клиента.

### Серверный барьер — отдельные правила кандидата

`archiveMigration/{uid}/{slug}` — закрытый для зрителей owner-only документ с фазой и монотонной generation. Из отсутствующего состояния можно перейти в `frozen`; до переключения разрешено отменить заморозку (`legacy`) и начать новую; `v3` терминальная фаза. В `frozen` старые клиенты не могут изменить/удалить V2, V3 допускает только создание отсутствующей записи с точным соответствием исходному ID, дате, сопернику и всем счётам. После `v3` V2 остаётся читаемым, но не изменяется; V3 допускает обычную редакцию. Переход в `v3` **не доказывает полноту сам по себе**: оператор обязан независимо сверить весь архив и завершить переключение клиентов, сохранить резервную копию; одновременные владельцы должны согласовать один сеанс миграции. Автоматического отката после новых записей V3 нет. Родительскую публикацию можно снять в любой момент (безопасность видимости). Правила и миграция проверяются только в эмуляторе; production правила не изменены.
