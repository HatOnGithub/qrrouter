## 2.6.14 — Six-character QR inventory IDs
- New QR labels use six characters: five random base-31 symbols and one check character for detection of common typing mistakes.
- The shortened alphabet excludes visually ambiguous 0, 1, I, L and O. The checksum detects any single-character substitution and adjacent transpositions in the data portion.
- Keep existing 10-character and prefixed QR identifiers valid without conversion; old print batches and stock remain unchanged.
- Apply checksum validation consistently in PHP, registration/workflow camera selection and standalone camera scanning.
- Add PHP/JavaScript checksum parity, short-code batch registration and compatibility regression tests.

## 2.6.13
- Updated displayed item-type names without changing stored keys.
- Added French localisation and expanded Dutch localisation of module navigation, registration, inventory and warehouse operations.
- Core Dolibarr menu titles now use translatable keys. Static module HTML labels and common scanner/lookup status messages are localized without changing submitted values or URLs.

## v2.6.12
- Prefer saved item labels over QR IDs across inventory, review, registration summaries, loan lists, movement outcomes, detail screens, picking and printouts. Keep QR IDs visibly available as secondary identifiers and unchanged as stable machine keys.
- Include automated display-priority regression tests; no stock or schema changes.

# 2.6.11 — Preserve camera action when returning from manual entry

- Fix the **Back to camera** link on manual QR entry, which previously always navigated to generic `camera.php` and lost the selected operation.
- Route back to the appropriate registration mode (including the Copy template), Move / Checkout / Check-in / Consume scan page, or destination-box camera (including its source box).
- Show the active action on the manual entry page and provide a context-aware camera link on the scan-review step as well as the entry step.
- Accept only known module routes/operations when constructing return URLs; no arbitrary redirect parameter is used.
- Add regression tests for all supported actions and round trips through manual review.

# 2.6.10 — Restore camera viewfinder bounds

- Load the previously missing camera/workflow UI stylesheet from the shared Dolibarr page layout. This fixes oversized camera views on the installed module.
- Replace the 950px / 690px tall camera with centered desktop and mobile viewfinders capped at 480×270px and 420×240px, respectively.
- Keep video inside its stage regardless of stream pixel dimensions; allow `display:none` when the camera is stopped. Preserve auto-start, scanning and manual-entry logic.
- Add HTTP coverage for the stylesheet link and browser layout regressions for narrow/short viewports, oversized video dimensions and camera stop visibility.

# 2.6.9 — Scan-review workflow and responsive UI

- Fix mobile floating-menu link typography and vertical alignment, with explicit padding and gaps.
- Tighten registration card spacing.
- Add responsive camera-first view and automatic startup with restart/manual fallback.
- Introduce a separate `manual.php` screen for single and bulk code entry across registration and stock actions.
- Add a selectable, compact scan-review table with known QR/product/location/status/quantity data, per-row checkboxes, select-all and unavailable-item filtering. Preserve unique registration auto-navigation to details.
- Add new local HTTP and Chromium review/navigation regression coverage; preserve native inventory operations.

# Changelog

## 2.6.8 — 2026-11-06

- Fix navigation dropdowns disappearing beneath Dolibarr content or being clipped by transformed/overflow-hidden page containers. Open desktop and mobile menus now move to a fixed-position body-level overlay with an elevated z-index.
- Give each open menu a measured, nonzero height, fit its width inside the visual viewport, and place above the trigger when there is insufficient space below. Keep internal vertical scrolling on narrow/short displays.
- Preserve keyboard Escape, outside-click closing, ARIA state, and menu switching. Close desktop menus when responsive breakpoints hide their trigger.
- Add browser overlay regression tests using intentionally clipped content and a high-z covering element at six desktop/mobile sizes, including a 280px-tall viewport and responsive resizes. Existing item and stock logic are unchanged.

## 2.6.7 — 2026-11-06

- Group top navigation into primary shortcuts, Stock actions, Labels & locations and More tools on desktop.
- Add mobile and tablet navigation with a permanently visible Scan QR shortcut and a scrollable Menu; 44px minimum touch targets and responsive width limits.
- Highlight active pages, close disclosures on Escape and outside click, and respect per-action Dolibarr permissions.
- Add navigation permission/active-route unit tests and real Chromium responsive layout tests at six viewport widths. No stock or QR-state schema changes.

## 2.6.6 — 2026-11-06

- Add per-warehouse local Binloc label formatting: hide levels already indicated by physical signage, optional level-specific separators and an optional warehouse prefix. Preserve complete inventory location keys and native stock state.
- Show shortened labels on item and bin inventory screens and printouts, with the full bin code available for disambiguation.

- Replace all single-choice QR Router dropdowns with progressive-enhanced, scrollable and keyboard-accessible menus, including dynamic Binloc lists.
- Fix dropdown clipping and width overflow in Dolibarr grids and panels; size option lists from the field width to a 680px cap and keep them in the viewport with a 340px scroll cap.
- Replace non-scrollable product multiselect results with an anchored, scrollable search list consistent with order and production-reference lookups.
- Version CSS/JS resources to force refresh and add browser-based layout regression tests.


## 2.6.5 — 2026-11-06

- Request camera access before waiting for the Firefox JavaScript decoder, releasing the
  camera cleanly on a decoder download failure.
- Added persistent stock-fixture HTTP contract tests for registration, native transfers,
  checkout/check-in, consumption, return, corrections, reference selection and error paths.
- Added a single test runner and a QA coverage report. Live Dolibarr/Binloc and real
  camera hardware acceptance remain outstanding.

## 2.6.4 — 2026-11-06

- Add Firefox camera support using getUserMedia and jsQR 1.4.0 software decoding if native BarcodeDetector is missing, or fails at runtime.
- Share the camera decoder between standalone scanning, registration, and all bulk workflows.
- Preserve immediate Serialised Unique details and cropped scan thumbnails.
- Allow optional self-hosted jsQR configuration; otherwise load a pinned CDN version only for fallback.
- Add JavaScript regression tests for native, fallback, and cancellation behavior.

## 2.6.3 — 2026-11-06

- Provide Move this item and Consume this item actions on QR item detail and edit pages; preselect the item in the shared workflow review (GET is read-only, POST required to perform changes).
- Replace scroll-problematic native customer order/reference select lists with accessible scrolling results panels on pick and consume screens.
- Fix the MRP permission check to use the Dolibarr 21 `mrp.read` right rather than the nonexistent `mrp.lire` right.
- Enable browsing the most recent 100 shipment, MRP manufacturing and sales orders, with optional reference filtering.
- Add HTTP and JavaScript regression tests for item-card workflow deep links and order selectors.

## 2.6.2 — 2026-11-06

- Validated actual HTTP print, register, copy/new, generic bulk, counted-container and summary flows using a temporary PHP server with a simulated Dolibarr bootstrap. No remote environment was modified.
- Reject Dolibarr service products during warehouse-stock registration; only physical products can later participate in stock movements.
- Check destination/source warehouses for closed status before staging QR-native stock operations, avoiding unnecessary reconciliation of requests that never posted stock.
- Validate source native lot/serial availability before writing a pending stock operation, with the regular execution-time validation retained.
- Added regression coverage for closed warehouses and the new registration validation, and instructions to run PHP tests with assertions explicitly enabled.

## 2.6.1 — 2026-11-06

- Serialised Unique scanning now immediately opens the detail form after the first QR is scanned, whether by camera or keyboard scanner.
- Camera scans capture a cropped 144-pixel JPEG preview and save it on registration in the private Dolibarr document directory. Handheld scanners use a generated QR preview.
- Added read-protected `thumbnail.php` for stored scan thumbnails; item details and registration summary display the thumbnail.
- Added `batches.php` overview of unregistered QR labels, including standalone labels and print-batch progress.
- Linked Unregistered QR batches directly from main menus, registration, label printing and printable batch sheets.
- Added print-remaining-only mode to the batch print page.
- Fixed the item details page status variable being displayed before initialization.
- Added PHP and JavaScript regression tests for new scanning and label tracking behavior.


## 2.6.0 — 2026-11-06

- Guided print → registration flow with serialised unique, generic bulk, and counted SKU containers.
- Save/finish, save/next-copy and save/next-new registration for individual items and boxes; round summary.
- Shared QR selection UI for many-to-one moves, checkouts, check-ins and consumption, including scanner input and camera fallback.
- Native Dolibarr warehouse transfers for QR moves, and existing employee handoff integration for bulk checkout and check-in.
- Partial consumption and returns, consumption history and optional business transaction references.
- Native stock corrections for existing counted containers, with unknown-count baseline handling.
- Durable staged stock actions and unique stock movement evidence reconciliation.
- Lifecycle/status-aware availability, warehouse summaries and picking; prevents metadata editing from resetting consumed units.
- New mock-native-stock regression tests and staging checklist.

## 2.5.0

- Bulk QR label generation, random short labels, Binloc-aware storage and native employee personal-warehouse handoffs.
