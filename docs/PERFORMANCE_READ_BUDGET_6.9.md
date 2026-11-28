# Performance 6.9 — детерминированный бюджет чтения

В обязательном CI-бенчмарке `tools/performance-benchmark.mjs` замеряются реальные результаты getAll хранилищ и индексов fake-indexeddb на синтетической базе: 12 команд, 100 матчей на команду, 216000 игровых событий, 24 класса. Инструментация действует только во время отдельных контрольных чтений и отключается до измерения времени.

Бюджет школьного интерфейса — ровно один запрос на каждое хранилище schoolViewStores и ноль прочитанных матчей; бюджет командного интерфейса — один запрос на каждое хранилище coachStores, только picker читает все команды, остальные обращаются к teamId выбранной команды. Возвращается 100 матчей вместо 1200. CI падает при выходе за область, повторном чтении или полном сканировании с последующей фильтрацией. Результаты прежнего и нового путей дополнительно должны совпадать, полная резервная копия остаётся полной.

Миллисекунды и коэффициенты ускорения — диагностические показатели, не жёсткие пороги для общей инфраструктуры CI. Это не измерение физического iPhone/PC, пикового потребления памяти или времени запуска PWA. Они остаются условиями отдельной приёмки. Производственный код и данные не изменены.

## RC5 preparation — seasonal training history index

Seasonal training comparison builds a fresh method/period/player-scoped index once instead of scanning the complete training archive for each athlete. Selected sessions are sorted once by date and ID. Excluded/archived players, unknown results, adaptation and separate methods retain their former semantics; no persistent cache and no schema change. The deterministic CI fixture uses 8,000 training sessions, 80 athletes and 14 results per session, checks equality to the original per-player lookup and counts result-map enumerations (one per selected session). Milliseconds remain diagnostic synthetic measurements, not physical device acceptance.

## RC5 preparation — scoped seasonal match comparison

Seasonal comparisons select eligible athletes once and exclude matches with no eligible roster member before constructing indexes, reading assist events, or replaying detailed matches. Period and source filters and per-athlete result semantics remain unchanged; archived athletes are included only when requested. The deterministic regression includes 2,000 irrelevant roster records and asserts zero detailed-log accesses across the selected-position comparison. No persisted cache, storage schema change or physical-device acceptance is implied.

## RC5 preparation — pure coach analytics decomposition

The calculation and CSV functions live in `js/coach-analytics.js`, with the existing `coach.js` exports retained as a compatibility facade. Seasonal ranking uses the pure module directly. Player cards reuse their existing court-time snapshot instead of calculating it again. The new module is explicitly precached and packaged for offline PWA review. Native and encrypted coach commands, data schemas and version remain unchanged. Existing regressions and an export-identity test guard compatibility; physical-device timing and memory acceptance remains open.

## RC5 preparation — imported match CSV timing snapshot

Imported match CSV calculates set participation and timeout evidence once per match, then derives independent per-player results using the same full/changed/bench/unknown semantics as the individual player view. A regression counts substitution-list iterations and compares batch results to the individual calculation, including missing evidence. Empty-roster CSV rows retain all header columns. No schema, persistent cache, publication or version change; physical-device export remains unverified.

## RC5 preparation — pure school analytics and shared period evidence

The storage-facing school analytics facade delegates to a pure calculation module. One full-class attendance evidence scan supports both selected-period statistics and whole-plan KTP completion; the same date is applied consistently. Individual grades and monthly trend share one grade-cell traversal. Period and pupil filters, unknown attendance, explicit absence and future lessons retain their semantics. A deterministic regression counts exactly one mark-array traversal per calculation including 2,000 unrelated records and verifies recomputation after edits. The new module is in the PWA precache; no database, persisted cache or publication change. Physical performance remains unverified.

## RC5 preparation — incremental journal attendance

On a grade notification, the journal builds one fresh period evidence snapshot, compares the confirmed-lesson IDs with the previous render and updates only changed pupils' attendance when shared evidence is unchanged. First/last manual evidence changes refresh all pupil attendance; held/pending filtered views and date changes trigger a full render so stale columns cannot survive. Cards reuse the snapshot on notification and initial render. The deterministic regression covers 30 pupils, duplicate notifications, first/last evidence and date rollover; Chromium verifies no mutation of an unrelated attendance cell and retained 1,079 badge nodes. No persisted cache, schema or version change. Physical acceptance remains open.

## RC5 preparation — match history view index and append-only paging

The local match archive prepares a sorted metadata index once per view, accumulating score and point totals in one traversal of each match's sets. Search/date/source/outcome changes query that index without replaying detailed logs, rescanning sets or sorting again; summary always covers the full filtered archive. Show-more appends up to 20 new cards without replacing existing nodes; filter changes reset to the first page. The 1,200-match regression verifies one set traversal per match, zero event reads, stable ordering and fresh rebuild after edits; Chromium verifies 45 synthetic rows and retained nodes. No schema, persistent cache, deployment or version change; physical-device performance remains unverified.

## RC5 preparation — purpose-scoped LIVE and dossier reads

The LIVE center reads only the selected team's players, drafts and lineups (one exact team lookup and three indexed requests). Opening detailed setup reads fresh players, matches and lineups on demand; the dossier and lineup assistant read only selected-team players, training, matches and tests. Preflight/start checks count only the selected team's drafts. No team fallback or global archive scan; the global snapshot remains unchanged for backups and global workflows. Scoped encrypted session views follow the same revocation lifecycle. Tests instrument IndexedDB with 1,200 irrelevant match rows, check exact store/key budgets and missing/archived teams; Chromium instruments real LIVE-center opening. No schema or version change; physical timing remains open.

## RC5 — season ranges, video projection and Studio geometry

Season progress aggregates selected-team trainings and matches once by date and derives phase/week/gap counts using sorted date prefix totals. A regression compares every range of a 730-day plan (105 weeks) against the previous independent scan with 8,000 training and 1,200 match rows, counting one date read per selected-team record. Season screen reads just selected-team training and match indexes. Video review projects an already prepared local rally snapshot without replaying the source log on filter changes, preserving unknown PDF times and provenance. Studio geometry helpers preserve size/order and account for object-fit contain letterboxing. Chromium checks new review filters and alignment controls. No physical-device timing, migration or publication claim.
