# Performance 6.9 — детерминированный бюджет чтения

В обязательном CI-бенчмарке `tools/performance-benchmark.mjs` замеряются реальные результаты getAll хранилищ и индексов fake-indexeddb на синтетической базе: 12 команд, 100 матчей на команду, 216000 игровых событий, 24 класса. Инструментация действует только во время отдельных контрольных чтений и отключается до измерения времени.

Бюджет школьного интерфейса — ровно один запрос на каждое хранилище schoolViewStores и ноль прочитанных матчей; бюджет командного интерфейса — один запрос на каждое хранилище coachStores, только picker читает все команды, остальные обращаются к teamId выбранной команды. Возвращается 100 матчей вместо 1200. CI падает при выходе за область, повторном чтении или полном сканировании с последующей фильтрацией. Результаты прежнего и нового путей дополнительно должны совпадать, полная резервная копия остаётся полной.

Миллисекунды и коэффициенты ускорения — диагностические показатели, не жёсткие пороги для общей инфраструктуры CI. Это не измерение физического iPhone/PC, пикового потребления памяти или времени запуска PWA. Они остаются условиями отдельной приёмки. Производственный код и данные не изменены.

## RC5 preparation — seasonal training history index

Seasonal training comparison builds a fresh method/period/player-scoped index once instead of scanning the complete training archive for each athlete. Selected sessions are sorted once by date and ID. Excluded/archived players, unknown results, adaptation and separate methods retain their former semantics; no persistent cache and no schema change. The deterministic CI fixture uses 8,000 training sessions, 80 athletes and 14 results per session, checks equality to the original per-player lookup and counts result-map enumerations (one per selected session). Milliseconds remain diagnostic synthetic measurements, not physical device acceptance.
