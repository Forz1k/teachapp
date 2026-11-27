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
