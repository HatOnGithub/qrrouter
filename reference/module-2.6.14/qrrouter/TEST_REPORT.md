# QR Product Router v2.6.14 — Short identifiers and QR error-correction verification

- All PHP and JavaScript syntax checks and offline regression suites: **PASS**.
- Added 6-character identifiers comprising five random characters plus one check character: **PASS**.
- New label generation, 1,000-code uniqueness test, invalid-check rejection, single-character typo rejection and adjacent payload-character transpositions: **PASS**.
- Existing 10-character and prefixed QR labels remain accepted: **PASS**.
- Both native QR detection and Firefox software-decoder simulation accept new 6-character labels, in addition to legacy labels: **PASS**.
- Printed QR endpoint remains TCPDF `QRCODE,H` (Reed–Solomon level H), the highest of the standardized recovery settings: **verified in source**.
- Simulated HTTP integration verifies 6-character label batches, registration and Dolibarr inventory workflows: **PASS**.
- Actual physical scratch-recovery testing, real Dolibarr/Binloc site integration, and camera testing in Firefox: **not performed**.

## 2.6.13 localisation and item-type checks

- Type names are **Tracked Individual**, **Tracked Generic**, **Counted Container** in English. Removed the parenthesized descriptions from those type labels.
- The internal type keys remain `tracked`, `generic`, `box`; no data migration required.
- `nl_NL` and `fr_FR` translations added with English fallback. Dolibarr's current user language is used.
- Navigation, registration, inventory, labels, manual input, primary stock workflows, and common JavaScript scanner/search messages localized.
- Locale regression tests verify English/Dutch/French HTTP rendering; native form values and QR navigation routes remain unchanged, including `mode=box`.
- Local PHP, JS, stock-workflow, mock HTTP and inventory integration suites pass.
- Real Dolibarr and Binloc installation and physical Firefox camera have not been tested in this environment; unusual backend validation messages may remain English.

## v2.6.12 label-priority checks
Added `tests/test_item_identity.php` for named, unnamed and unassigned items, escaping, stable QR IDs in links and scan-review checkbox values. The HTTP suite checks label-first inventory, item details and review screens. All offline suites pass, and the responsive Chromium UI suite passes at six viewport configurations. The actual Dolibarr development server remains untested.

# QR Product Router v2.6.11 — Manual entry camera context

- Return routes for registration (Unique, Generic, Box), registration Copy template, all four stock workflows, destination-box transfer and generic lookup are covered by unit and HTTP tests.
- Manual entry -> manual review -> camera links are verified to preserve the original action without modifying stock.
- No changes to inventory data or Dolibarr stock integration. Live Dolibarr/browser acceptance is still outstanding.

# QR Product Router v2.6.10 — QA (2026-11-06)

- `workflow-ui.css` is now referenced in the rendered layout, verified on standalone camera, unique registration and stock workflow HTTP fixture pages.
- Headless Chromium checks at desktop, tablet and mobile sizes verify camera width/height caps, centering, no overflow with a 3840×2160 video, and respect for `display:none` when the camera stops.
- Previous offline regression suites cover PHP/JS, scanner behavior and Dolibarr stock contract integration; no stock logic changed.
- **Real hardware camera and deployed Dolibarr/Binloc testing remain outstanding.**

---

# QR Product Router v2.6.9 — QA (2026-11-06)

- PHP syntax, JS syntax, all prior unit suites, and simulated Dolibarr HTTP stock-integration tests: **PASS**.
- Registration review HTTP tests: unassigned ID detail lookup, checked selection, excluded IDs, bulk manual handoff, unknown IDs disabled, and CSRF failure: **PASS**.
- Camera JavaScript: native detection, jsQR fallback, runtime native-failure fallback, stop/release and **automatic camera start**: **PASS (mocked camera)**.
- Chromium at 320, 390, 768, 1280 px: **PASS** for menu button vertical alignment/size/gap, registration card spacing, large camera viewport, table horizontal scrolling, sticky selection behavior and select-all interaction.
- Previous navigation overlay browser tests: **PASS** at six viewport sizes.
- Real Dolibarr 21.0.2 + installed Binloc integration and a physical Firefox camera remain **not tested in this environment**. Verify on staging before production stock changes.

---

# QR Product Router v2.6.8 — QA report (2026-11-06)

## v2.6.8 additional checks

- Page-level navigation overlays were tested in headless Chromium against ancestor `overflow:hidden`, transformed stacking context, and a covering `z-index:999999` page element. Each desktop group and the mobile menu remained visible, correctly sized, in-bounds, hit-testable and scrollable as needed at **1280x800, 1024x700, 1000x680, 390x650, 320x440 and 375x280** — **PASS**.
- Switching between desktop groups, Escape dismissal, and changing a desktop open menu to a mobile viewport — **PASS**.
- Original PHP and JavaScript tests, HTTP registration/stock fixtures and responsive navigation checks at six widths — **PASS**.
- Live hosted Dolibarr styling and Firefox browser testing remain **not performed**; verify after installing on staging.

## v2.6.7 additional checks

- Native PHP permission and route tests: read-only, manager and administrator menus, active workflow sections, access-filtered links, and ARIA attributes — **PASS**.
- Playwright/Chromium browser checks at **1280, 1001, 1000, 820, 390 and 320 px**: visible desktop/mobile mode, no horizontal page overflow, bounded desktop popover, scrollable mobile panel with mouse wheel, Escape dismissal, current-page highlighting, and readable white text on primary Scan QR button — **PASS**. Browser checks use a fixture built from the actual PHP renderer and module CSS/JS.
- All pre-existing PHP, scanner, lookup, registration HTTP and native-stock fixture suites — **PASS**.
- Live hosted Dolibarr and physical Firefox touchscreen tests — **not performed**.

## v2.6.6 additional checks

- Local Binloc formatting: omitted display levels, empty and per-level separators, optional warehouse prefix, unknown-option fallback, validation and preservation of full location identifiers — **PASS (PHP unit tests)**.
- Dropdowns: all QR Router native single-select fields are enhanced by one bounded, scrollable component, including dynamically loaded Binloc options; product/order/reference lookups use the same 680px max-width and 340px scrolling cap — **static code/syntax checks passed**.
- Headless Chromium UI automation could not finish in this execution environment (Chromium itself hung loading `about:blank`), so **live browser layout and mouse-wheel verification are outstanding**. An optional layout test harness is included under `tests/test_dropdowns_browser.py` for a working browser machine.
- Inventory compatibility: short Binloc labels are *presentation only*; `bin`, `bin_key`, `bin_values` and native Dolibarr stock records remain unchanged.

## Automated verification performed

| Area | Scope | Result |
| --- | --- | --- |
| PHP syntax | Every PHP source and test file | PASS |
| JavaScript syntax | All module JavaScript files | PASS |
| Unit / integration contract tests | All PHP test suites, assertions enabled | PASS |
| Scanner logic | Keyboard input, native BarcodeDetector, Firefox jsQR simulation, runtime failure, library failure, thumbnail handoff, standalone camera | PASS (mocked camera/decoder) |
| Order selection logic | Shipment, sales order and MRP search/dropdown interaction | PASS (mocked DOM/API) |
| Registration HTTP | Preprinted batches; generic, unique and quantity-box registration; Save/Next Copy/New; summary; CSRF; read-only item shortcuts | PASS (fake Dolibarr bootstrap) |
| Native stock HTTP contract | In-warehouse and cross-warehouse moves, movements and inventorycode evidence, consumption with production/sales-order links, partial returns, correction, employee checkout/check-in with auto-created warehouse | PASS (persistent native stock fixture) |
| Failure and integrity paths | Invalid token, closed warehouse, insufficient stock, duplicate selected QRs, invalid production reference, retained QR quantities on failed transaction | PASS (persistent native stock fixture) |

`tests/run_all.sh` runs every local suite with PHP assertions explicitly enabled.

## Not tested here — production acceptance gates

- **Real Dolibarr 21.0.2 and installed Binloc**: the development host `dolibarr-dev.deltaiot.com` could not be resolved or reached from this execution environment; no changes were made to it.
- **Actual Firefox camera**: a real camera and Firefox runtime were unavailable. Browser-level scanner tests use a mocked `getUserMedia` stream and decoder, and cannot prove live image recognition or browser permissions.
- **External jsQR availability**: jsQR 1.4.0 is loaded from the pinned jsDelivr URL unless `assets/vendor/jsQR.js` has been provided on the server. The CDN and production CSP could not be tested; for reliable internal use, host a reviewed decoder locally.
- **Native Dolibarr batch/lot cases, kits, permissions and multi-entity behavior**: mock classes cover the subset exercised, but do not replace live functional testing.
- **True end-to-end customer order, shipment or MRP execution**: linking reference records is tested; automatic detection of native stock already deducted by Dolibarr is not implemented.
- **Full browser UI / printed QR generation**: a usable graphical browser and Dolibarr's PHP TCPDF package were unavailable in this execution environment.

## Live staging acceptance checklist

On a disposable warehouse with controlled test quantities, verify:

1. Module access/menu permissions and Binloc levels for a non-admin user.
2. Firefox opens the camera, decodes several actual QR labels, records a thumbnail and immediately opens unique details.
3. Preprint and reprint unassigned batches, register one unique, several generic and one counted container; confirm **registration posts zero native stock movements**.
4. Move within the same warehouse and between two warehouses; inspect both corresponding `llx_stock_mouvement` rows and the QR location.
5. Check out and check in one and several items, ensuring personal employee warehouses are created/reused correctly.
6. Consume a tracked unit and part of a counted container; verify native movements and QR consumed quantity, then return part/all.
7. Test both *deduct now* and *already deducted* against a real shipment, sales order and manufacturing order; verify there is no double deduction.
8. Adjust a box quantity up/down, and reject a correction larger than available native stock.
9. Verify lot/serial products, permission denials, closed warehouses, duplicate scans, pending transaction reconciliation and concurrency with another stock operator.
10. Repeat from a mobile Firefox device using the installed site HTTPS/CSP settings.

Do not promote to production before these tests pass on the **actual** development Dolibarr instance.
