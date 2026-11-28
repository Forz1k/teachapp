# Видеоразбор 6.6 — происхождение отметок и защита записи

Каждая отметка показывает происхождение: ручная точка, интерполяция, оценка вне контрольных точек, оценка по времени протокола или отсутствие привязки. Ручная точка хранит выбранное пользователем время; остальные оценки не гарантируют точность кадра. PDF остаётся без интерполяции.

Редактор сохраняет заметки и точки через транзакционную сверку полного исходного снимка с актуальной записью. При конкурирующей записи, удалении, дубликатах или исчезновении матча операция отклоняется без перезаписи; индексы сверяются с протоколом. Старый общий API saveWork сохраняет совместимость, но UI использует специальную операцию. Схема backup не меняется. Необходима физическая проверка воспроизведения, точности и локального экспорта на устройстве. Тесты используют синтетические записи; видеофайл не загружается в хранилище.


## Навигация по отметкам

Кнопки предыдущей/следующей отметки используют только текущий отфильтрованный список, игнорируют неизвестное время, непривязанные PDF-розыгрыши и позиции вне открытого файла. Переход останавливает воспроизведение и A–B, устанавливает время отметки без отступа; при экспорте отключён. Окно 50 мс предотвращает повторный выбор текущей отметки после округления seek; на границе нет циклического перехода. Оценочные отметки сохраняют прежнюю маркировку, точность кадра не гарантируется. Нет сохранения новой информации и передачи видео.

### Playback navigation read budget (6.9)

The filtered marker index and note lookup map are built when the filters, alignment or record changes. Playback events now use binary search for both adjacent markers and the in-range count, instead of three linear scans per timeupdate. Equal times retain lowest rally index; no wrap, no unlinked or out-of-video marks. A 12,000-marker deterministic test compares results to the previous linear reference across duration/timestamp boundaries, duplicates and invalid values. No timing claim for physical iPhone; no schema or storage changes.

## RC5 preparation — filtered review report

The local CSV and summary use the complete current filtered rally list, including rows beyond the visible page. Unknown PDF times remain empty; manual, recorded, interpolated and extrapolated provenance is retained, with outside-file and favorite indicators. Player names and private notes are excluded by default, enabled only by an explicit checkbox and confirmation. No source file, internal IDs or server request. Spreadsheet-formula prefixes are escaped. A changed selection or closed sheet invalidates the confirmation. No schema change; physical download/open remains a manual acceptance requirement.
