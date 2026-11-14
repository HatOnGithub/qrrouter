# Frontend and printing

## Application state and navigation

`frontend/src/app/app.config.ts` configures Angular providers; `app.routes.ts` lazily loads standalone feature components. The same editor serves create/edit/registration-details routes. Inventory also serves the loans view. The root component owns module navigation, bootstrap loading/errors and the entity-wide pending synchronization banner.

The browser `InventoryService` owns a signal containing `Bootstrap`, with computed inventory items and loading/error signals. Components read this public snapshot and request explicit resources. Commands do not optimistically prove stock success; callers refresh afterward and inspect pending state and per-row results.

`can()` maps workflow names to independent grants (`correct`/`transfer` to Adjust, `checkout`/`checkin` to Loans) and adds relevant native-stock UI requirements. `canAny()` supports pages with several independently permitted actions. These helpers control interface availability, while PHP and C# enforce authorization on every actual operation.

`core/models/inventory.ts` describes the browser contract, not raw service state. Keep recovery snapshots and native evidence out of these models. `PendingDetail` is a safe before/intended-value row; full history is a separate paged model.

## Feature responsibilities

| Feature                            | Main interaction                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `inventory`                        | Search/filter public inventory, loans and links/actions                                    |
| `item`                             | QR details, pending notice/reconciliation, permitted actions and embedded movement history |
| `editor`, `registration`, `labels` | Metadata forms, label registration and single/bulk creation/printing                       |
| `scan`, `workflow`                 | Choose action, capture eligible codes, review quantities/destination and submit            |
| `locations`                        | Internal location reports and level/format configuration                                   |
| `bins`                             | Physical bin creation, membership and recoverable whole-bin moves                          |
| `picking`                          | Native requirements, proposals, saved lists and manual completion                          |
| `people`                           | Employee warehouse mappings                                                                |
| `history`                          | Paged global/per-QR operation summaries                                                    |
| `csv`                              | Parse, preview, validate, import and export inventory rows                                 |

## Scanning and destinations

`ScannerComponent` owns camera acquisition, frame decoding through the shared `BarcodeDecoder`, identifier normalization, duplicate suppression and bounded selection. The decoder retains `jsQR` for QR and adds ZXing readers for Data Matrix, Code 128 and PDF417. Stop/restart and destroy release the media stream and animation frame. A generation counter prevents an old asynchronous camera startup/frame loop from continuing after a newer session or stop. See [barcode carriers and layouts](barcodes.md).

`codes.ts` normalizes bare IDs and QR Router URLs, validates short/legacy identifiers and recognizes storage-location and physical-bin payloads. It preserves the case-sensitive encoded payload of location/bin scans. These checks improve capture feedback; PHP still validates payloads and access.

`CaptureComponent` wraps the scanner and owns the route's camera/manual mode through query parameters. The scanner reports codes; workflow-specific validation is supplied by the feature. This lets camera and manual/USB entry share the same eligibility checks.

`WorkflowComponent.validateScan()` rejects unknown, unassigned, pending or unsuitable items before review. Container transfer needs exactly two compatible containers in source-first order. Guarded picking rejects items outside the loaded proposal. The server repeats these checks using fresh state when staging.

`DestinationComponent` resolves a location QR through PHP and emits the validated choice. It shows the resolved contents only while the selected warehouse/level values still match that scan. Generation/sequence counters in asynchronous pick/history loads similarly prevent older responses from replacing newer selections.

## CSV import

`csv.ts` contains the CSV representation/parser/export rules. `CsvImportService.preview()` refreshes inventory, classifies each row as create/register/update/skip, checks duplicates, resolves products and locations and records the revision used for preview. It preserves the difference between omitted values, blank fields, zero and unknown quantity where the import rules require it.

Applying an import checks for changes since preview and uses the normal gateway commands and action grants. It stops at the first failed row and preserves completed rows so they are not blindly submitted again. Native-linked fields are constrained through the same creation/edit paths as the ordinary interface. A preview is user feedback, not permission to bypass server validation.

## Reusable components and services

- `SharedModule` exports standard Angular/material controls, translation, native links, cards and pending details. Standalone controls with additional responsibilities are imported explicitly by their consumers.
- `PendingDetailsComponent` renders a native `<details>`/`<summary>` foldout with an accessible table, metadata and an empty/unavailable fallback. It renders server-selected strings through Angular interpolation, not raw HTML, and performs no recovery action.
- `HistoryComponent` accepts an optional item code or reads a route filter. It converts local selected days to UTC query boundaries and ignores responses from older requests.
- `ConsumptionService` finds the latest consume entry and resolves only references present in the authorized bootstrap catalog.
- `NativeLinksService` and native-link controls construct known native-card URLs from positive record IDs. They do not authorize those records; destination endpoints still enforce access.
- `TranslationService` uses bootstrap strings and bounded character-entity decoding. It decodes individual entities without treating the surrounding text as markup.
- `DolibarrThemeService` adapts the module to host theme/style changes. Feature styles remain with the feature rather than modifying unrelated host pages.

UI strings use the `t` pipe. PHP provides hashed `QRRUI_...` translations from language files plus Dutch/French SPA dictionaries. Add new SPA text to the relevant dictionaries and use plain text suitable for safe interpolation.

## Printing

PHP print endpoints authenticate users, require Print where applicable, check QR/native visibility and prepare a bounded print data model. They serve the standalone modules under `spa/print`; label rendering does not require booting the full Angular application.

`frontend/src/print/model.ts` selects label names, serials and detail rows for supported profiles. `main.ts` creates the print DOM using text nodes/text content, applies profile page dimensions and waits for printable content before enabling printing. `language.ts` supports print language selection. Profile definitions live in `dolibarr/qrrouter/assets/label-profiles.json`.

`label.php` and `batch_print.php` cover item labels; `bin_print.php` covers storage-location reports/labels and `physical_bin_print.php` covers permanent physical-bin identities. QR image and thumbnail endpoints enforce inventory/object visibility independently of whether a user arrived through a print page.

## Development mock

`frontend/dev` provides in-memory fixtures and a same-origin-shaped gateway for UI work. It includes pending, empty, read-only and unavailable scenarios, localized themes and a virtual camera. Its state and stock rules are test doubles; the real PHP/C# integration remains the authority for recovery and native stock behavior.

Playwright mock tests isolate stores with a session header. Keep fixture projections aligned with the public contract, including safe pending summaries; never make mock-only fields a production UI dependency. Production-hosted browser tests use a real service and PHP gateway against native API doubles. See [testing](testing-and-maintenance.md).
