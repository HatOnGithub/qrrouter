# QR Product Router v2.6.12 (Dolibarr 21.0.2 + Binloc)

**Staging release / source module.** This is an upgrade of `qrrouter` v2.5.0, not a new module. It uses Dolibarr products, warehouses and native stock movement methods, and it reads Binloc level configurations without writing Binloc tables. All QR metadata remains in the private Dolibarr document directory. No core patches.


## v2.6.12 — Item labels first

- Everywhere a QR item is shown to people (inventory, scan review, registration summary, movement results, checkout and pick sheets), a saved item label is the main name and the QR ID is a small secondary identifier. Unassigned or unlabelled QR items still show the QR ID first.
- Item identification is purely a display change; QR values remain the stable keys used in links, form inputs, transactions, labels and scanning.
- Existing labels are not modified; the inventory state format is unchanged.

## v2.6.10 — Camera preview size correction

- Fix the root cause of excessive camera size: `assets/workflow-ui.css` was not loaded on actual Dolibarr pages. It is now included by the shared layout with a cache-busted URL.
- Cap camera previews at **480 × 270 px on desktop** and **420 × 240 px on mobile**, shrinking automatically for available space. The preview remains centered and does not affect the actual camera stream or QR decoding.
- The preview stays bounded even if the camera advertises a large native video resolution; stopping the camera hides the video and reveals the status placeholder.
- All scanner entry points (`camera.php`, `register.php` and `workflow.php`) share these limits. No database or stock changes.

## v2.6.9 scanning and responsive interface

- **Mobile navigation:** menu links are now 13 px, vertically centered with a 39 px minimum hit area and visible gaps, including in page-level floating popovers.
- **Registration choice cards:** reduced nested panel margins and tighter consistent grid spacing.
- **Camera-first scanning:** the camera attempts to start when the page loads, with a larger preview (responsive viewport height). Failure or denied permission keeps a visible restart control and a manual-entry link. Firefox continues to use the jsQR software fallback.
- **Separate manual code entry:** open `manual.php` from Scan QR, registration or a stock workflow. Enter one identifier or paste up to 200 identifiers. All entries are reviewed before moving on. The review can inspect a single item or start registration, moving, checkout, check-in or consumption. A destination-box flow also preserves its source.
- **Selectable scan review:** compact table with per-row checkboxes (checked by default), Select all, QR thumbnail/preview, known product, warehouse/Binloc, status and quantity. Invalid/unavailable labels are visible but cannot be selected. Selecting zero entries is blocked both in the browser and on the server. On narrow screens, the checkbox column stays visible while the table scrolls.
- **Preserved Serialised Unique behavior:** a successful camera scan still opens the detail form immediately and carries its cropped QR thumbnail. Serialised Generic and Quantity Container scans now use the explicit review step before details.
- Stock rules, native Dolibarr transaction handling, Binloc storage and existing QR identifiers are unchanged. No schema migration is required.

**Browser note:** automatic camera startup requires HTTPS, a secure browser context, browser permission and a working camera. If blocked, press Restart camera or use manual entry.

## v2.6.8 visible navigation menus

- Opening Stock, Labels, or Tools on desktop and Menu on mobile now creates a **fixed, page-level popup**, outside Dolibarr content panels that may clip or overlay it. Closing a menu restores it to its original location.
- Popup height is calculated from the visible viewport (up to 440px on desktop / 650px on mobile) and stays scrollable. Menus can open upward near the bottom of the screen, and width is constrained inside the viewport.
- Menus remain usable through keyboard, touch, outside-click dismissal, responsive breakpoint changes and browser viewport resizing. Existing stock data and permissions are untouched.
- Browser overlay regression: `python3 tests/test_navigation_overlay_browser.py`, testing deliberate ancestor clipping and a competing high-z element at 1280, 1024, 1000, 390, 320 and 375px widths (including 280px viewport height). This tests rendered navigation locally; acceptance on actual Dolibarr remains necessary.

## v2.6.7 responsive navigation

- Replace the former 14-button wrapping header with four primary desktop shortcuts (Scan QR, Inventory, Register, Move) and grouped Stock actions, Labels & locations, and More tools menus.
- On tablets and phones (up to 1000px), keep **Scan QR** accessible in the header and place all available actions in a single scrollable **Menu** with large touch targets. The desktop menu uses bounded, scrollable popovers; neither layout should cause horizontal overflow.
- Highlight the current page/workflow, and close menus on Escape, outside click, or when another menu is opened. Native HTML disclosures and links remain usable without JavaScript.
- Hide actions that the current Dolibarr user is not permitted to access, including MRP/order and administrator-only tools. Existing routes, module data, and Dolibarr's own menu are unchanged.
- Browser validation: Playwright + Chromium at 1280, 1001, 1000, 820, 390 and 320px, including a mouse-wheel test on the mobile popup. Tests use a rendered fixture of the actual PHP navigation, not a live Dolibarr session. Run `python3 tests/test_navigation_browser.py` if Chromium and Playwright are installed.

## v2.6.6 dropdown and layout fixes

- Every single-choice dropdown in QR Router (warehouses, employees, item types, stock transaction types and dynamic Binloc levels) now has a custom scrollable menu with keyboard and pointer/touch support. The original native `<select>` remains the submitted form value and remains usable if JavaScript fails.
- Product searches now use the same scrollable result-button interface as sales and manufacturing order searches; the former native `select size=6` was replaced.
- All dropdown menus render in the viewport overlay layer rather than inside a Dolibarr grid/panel; menus are anchored to the field, automatically expand to fit their contents up to **680px**, and never exceed the available viewport width (12px safety margin). Maximum menu height is **340px**, with internal scrolling, search for long static option lists, and placement above the field when required.
- Includes keyboard navigation, Escape-to-close, dynamic Binloc level enhancement, and mobile viewport layout rules. Versioned CSS/JS avoids stale browser caches after upgrade.
- Browser-level smoke tests cover Firefox and Chromium at desktop and narrow viewport widths. Live Dolibarr/Binloc deployment still requires staging validation.

## v2.6.1 scanner and unregistered-label improvements

- **Serialised Unique:** enter the scanning screen, scan one label using a QR-capable camera or a handheld keyboard scanner, and the detail form opens **immediately**. No intermediate Finish Scanning step. Press Enter with a keyboard scanner or select Add scan for typed identifiers.
- A camera scan creates a small **144 × 144 JPEG thumbnail cropped around the detected QR**. It is previewed on the detail form, and saved when registration is confirmed. Stored thumbnails are private under `DOL_DATA_ROOT/qrrouter/entity-N/thumbnails/` and served only to authenticated users with QR read permission. A handheld scanner has no camera image; it displays the generated QR image instead.
- Save and Finish / Save and Next (Copy) / Save and Next (New) remain unchanged. Copy preserves reusable details but clears the previous serial and native Dolibarr batch/serial.
- New **Unregistered QR batches** page at `batches.php`, linked from the QR Inventory home page, left menu, global QR navigation, registration, print, printable sheets and registration summary. It lists remaining unassigned labels, including labels not in a printed batch.
- Reprint **only unregistered labels** in a batch using `batch_print.php?batch=ID&unassigned=1`, or reprint the entire original batch. An individual unassigned QR on the overview can be opened directly in the unique-registration detail form.
- Neither thumbnails nor unregistered-batch navigation change any Dolibarr stock or item quantity.

**Browser compatibility:** Native `BarcodeDetector` is used where available; Firefox and other browsers without it use `getUserMedia` video frames decoded by jsQR 1.4.0 locally in the browser. Camera access requires HTTPS and permission. By default the JavaScript decoder is loaded on demand from version-pinned jsDelivr; no image frames are sent to the CDN. To remove the CDN dependency, place the official jsQR 1.4.0 `jsQR.js` file in `assets/vendor/` as documented in `assets/vendor/README.md`; the module will use it automatically.

**Development environment validation:** Local PHP, HTTP and JavaScript tests were performed. Remote login/deployment on `dolibarr-dev.deltaiot.com` remains untested because network access is unavailable from this runtime.

## v2.6.3 item-card actions and order selection

- **Move this item** and **Consume this item** appear on QR item details and the editing page when the item is in stock and available. They open the existing review screen with that QR preselected; they do not mutate stock on GET.
- Consumption supports browsing recent shipment, production/manufacturing (MRP) and customer/sales orders as soon as the transaction type is selected. Search works by reference. Pick-sheet customer orders also load on search focus.
- Scrollable, keyboard-accessible result buttons replace native multiple-size select elements, avoiding platform/Dolibarr scroll behavior. The server still checks that the selected reference exists and the employee has the required permission.

## v2.6.2 test iteration

- Registration now rejects service products that cannot be held as native Dolibarr warehouse stock.
- Stock-changing workflows now validate that source and destination warehouses are open and any required source native lot/serial stock is present **before** persisting the pending operation. This prevents avoidable blocked QR items for routine validation errors.
- Added `tests/test_http_flows.py`, a local temporary Dolibarr-bootstrap fixture using PHP's built-in server. It exercises the actual `print_codes.php`, `batches.php`, `register.php`, and `register_summary.php` HTTP routes: preprinted batches, single-scan details, invalid saves, Save and Next (Copy/New), generic bulk assignment and counted containers.
- Run PHP tests with `php -d zend.assertions=1 -d assert.exception=1 ...`: on many PHP installations assertions are disabled by default and a superficial green test result may otherwise skip all assertions.

**Live validation remains outstanding:** This execution environment cannot access `dolibarr-dev.deltaiot.com` for login or installation. Local HTTP tests use a simulated Dolibarr bootstrap and **do not** prove Binloc integration, native stock movements on the real database, or deployment compatibility. Verify staging before production.

## Install / upgrade

1. **Back up the Dolibarr database AND `DOL_DATA_ROOT/qrrouter/`**, including `entity-N/state.json` and its full history. Dolibarr SQL backups do *not* include the JSON state.
2. Copy the `qrrouter/` folder into `htdocs/custom/qrrouter/` (replacing the previous module files), or use Dolibarr's external-module deployment interface.
3. Use **Dolibarr 21.0.2**, with Products, Stock and Binloc enabled. Disable/enable QR Product Router after upgrading to refresh its left menu; existing permissions/records are retained.
4. Grant QR Router read/manage permissions. Native transfers, returns, corrections and consumptions also require Dolibarr's **Stock → Create stock movements** permission. Automatic creation of an employee warehouse also requires **Stock → Create warehouses** permission.
5. Test in a staging Dolibarr installation using your actual products, warehouses and Binloc configuration **before modifying production inventory**. No live Dolibarr environment was accessible for end-to-end testing.

### Compatibility

- QR state format **schema 2** is unchanged. Old tracked, generic, box and unassigned records are read without migration. Missing `status` is interpreted as `in_stock`, except unassigned labels. `consumed_units` defaults to zero. Existing loan and personal-warehouse mappings remain valid.
- New QR codes contain **a six-character ID** (five random base-31 symbols and a check character). Existing 10-character and prefixed identifiers remain valid; stock and old labels are unchanged. The print page generates up to 200 unassigned codes per batch, with reprint support.
- Device camera uses native `BarcodeDetector` or falls back to browser pixel decoding with jsQR (including Firefox). HTTPS and permission are required, plus connectivity to jsDelivr by default for the fallback. Hardware/manual scanning works without a camera.
- All native warehouse stock mutations use Dolibarr Product methods; native lot/serial-managed products require the actual Dolibarr lot/serial in the tracked QR record. Generic and box QR records cannot automatically adjust a native lot-managed product unless extended to store a native lot identifier.

## Workflows

| Task | URL / menu | Behavior |
| --- | --- | --- |
| Print QR labels | `print_codes.php` | Creates a blank batch; printed codes are **not stock**. Batch printout links back to registration. |
| Register new items | `register.php` | Choose Serialised Unique, Serialised Generic or Quantity of SKU/Products. Preprinted codes must be unassigned. |
| Serialised Unique | `register.php?mode=unique` | Scan one code → enter product, warehouse, Binloc location, serial/details → **Save and Finish / Next (Copy) / Next (New)**. Copy never duplicates serial/native batch. |
| Serialised Generic | `register.php?mode=generic` | Scan multiple independent labels → apply common product and location once → summary. Each label represents one identifiable physical unit. |
| Quantity container | `register.php?mode=box` | Scan one label → product, known quantity, location → next/finish. One label identifies a counted container of one SKU. |
| Move | `workflow.php?action=move` or `workflow.php?action=move&code=...` | Scan many → select items (all checked by default, QR thumbnails included) → select one warehouse/Binloc destination → confirm. Same-warehouse move is QR-only; cross-warehouse move transfers stock natively. Full boxes move together; split them separately for partial quantities. Empty boxes can move without a native product movement. |
| Check out | `workflow.php?action=checkout` | Scan many → select employee and reason → Dolibarr stock transfers to their personal warehouse, auto-creating it when permitted. Save employee, timestamp and original location. |
| Check in | `workflow.php?action=checkin` | Scan checked-out items → show original locations → bulk confirm return to those original warehouses/Binloc positions. |
| Consume | `workflow.php?action=consume` or `workflow.php?action=consume&code=...` | Scan many → select optional shipment, manufacturing order or sales order → reason → whole unit/box or partial box quantity → mark consumed and optionally deduct Dolibarr stock. |
| Return consumed inventory | `return.php` | Scan a previously consumed QR → choose quantity, destination and condition/reason → reactivate retained QR identity; optionally increment Dolibarr stock. Partial-box returns must stay in the box's existing warehouse. |
| Modify item | `scan.php`, `manage.php` | Scan one → edit descriptive metadata without native stock changes. Existing counted container quantities cannot be changed here; use correction. |
| Stock correction | `correction.php?code=...` | Enter new known count and required reason → post the difference as a native Dolibarr stock adjustment. An **unknown** previous count may first be established as a QR baseline, but cannot safely create a numerical native stock adjustment until reconciled. |
| Reconcile interrupted stock action | `reconcile.php?code=...` | Inspect native Dolibarr stock-movement evidence by unique inventory code. Finalize exactly complete movements; cancel a stage with no movements; block ambiguous or partial evidence for manual investigation. |

### Inventory semantics and safeguards

- **Registration does not receive or add stock in Dolibarr.** Register labels for goods already present in native warehouse stock, or use an explicit native goods receipt before registration. This prevents duplicate purchase receipts.
- A scanned code never immediately changes stock. Review/confirm screens separate selection from mutation. Repeated scans are deduplicated; the server revalidates every code.
- **Moves across Dolibarr warehouses** perform native decrease+increase movements as one database transaction, then update QR location. Moves between Binloc positions of a single warehouse update QR metadata only.
- **Consuming** removes a whole tracked/generic item from available QR stock (retains its identity/history) or reduces a counted container quantity. A fully depleted box has `status=consumed` and count zero. All consumed quantities are recorded for potential returns.
- **Prevent duplicate deduction:** On consumption, select *Already deducted by Dolibarr* for a shipment or MRP order if the native process has already reduced stock. The UI suggests this mode for those reference types, but **the operator must verify it**. The module does not determine whether a particular Dolibarr shipment/MRP order has already posted the same items.
- **Returning** a consumed item can post native increase or, if a Dolibarr return has already done so, update only the QR record. Returned items are not given new QR identifiers.
- **Native stock corrections** require a known old box quantity and a reason. They are not silent metadata edits.
- **Batch operations are per-item commits.** They show a success/failure row per QR. If an item fails, already completed items remain committed. This is deliberate: native database stock movements and private QR JSON state cannot share one atomic transaction.
- Every staged native operation uses a unique `inventorycode` (`QRR-...`) and saves a `pending_operation` before moving stock. The QR item remains locked on uncertainty until evidence is reconciled. Existing checkout/check-in operations continue to use their separately tested `pending_handoff` mechanism.
- Native product/warehouse rights, source stock, closed warehouses, active employee/warehouse mappings and existing native lot/serial are validated. A native transfer with insufficient stock is refused.
- Returns to different warehouses are only permitted for fully consumed boxes or individual items; partially consumed boxes must return to their current warehouse before a whole-box move.

## Data model

`DOL_DATA_ROOT/qrrouter/entity-N/state.json` remains **schema=2**. Each item keeps its existing `code`, `type`, `product_id`, `warehouse_id`, `bin`, `bin_values`, `qty`, `serial` and metadata. The new optional fields are:

- `status`: `in_stock` / `consumed` (unassigned labels remain `unassigned`).
- `consumed_units`: number of previously consumed units not yet returned, including partial box consumption.
- `consumed_at`: timestamp when an item became fully consumed.
- `consumption_log`: appended entries of consumed/returned quantities, reference, reason, stock posting mode and native inventory code.
- `pending_operation`: durable native-stock action staged but not yet finalized in QR state; includes effects, intended patch and inventory code.

`state.history` continues to record the acting Dolibarr user, timestamp and action. Existing `checkout` / `pending_handoff` records remain compatible with prior releases. The native Dolibarr stock movement table is authoritative for warehouse stock quantities, while QR Router tracks per-label identity and Binloc position.

## Testing

Run locally with PHP assertions enabled and a local PHP/Python runtime:

```sh
find qrrouter -name '*.php' -print0 | xargs -0 -n 1 php -l
php -d zend.assertions=1 -d assert.exception=1 qrrouter/tests/test_aggregates.php
php -d zend.assertions=1 -d assert.exception=1 qrrouter/tests/test_handoff.php
php -d zend.assertions=1 -d assert.exception=1 qrrouter/tests/test_v250.php
php -d zend.assertions=1 -d assert.exception=1 qrrouter/tests/test_workflows.php
php -d zend.assertions=1 -d assert.exception=1 qrrouter/tests/test_scan_registration.php
node qrrouter/tests/test_scanner.js
python3 qrrouter/tests/test_http_flows.py
```

`test_workflows.php` exercises QR registration, duplicate prevention, same/cross-warehouse moves, signed native movement evidence, partial box consumption, quantity corrections, returns, cancellation with no movement evidence and recovery after a simulated completed native stock commit. These are **isolated tests with mocked Dolibarr APIs**, not proof of compatibility with your actual installation.

### Required staging acceptance tests

1. Back up both DB and QR state. Install/update on a Dolibarr **21.0.2** test system with your Binloc version.
2. Print and register one tracked QR, several generic QRs and one counted container. Verify the native stock total **did not change** during registration.
3. Move a label within one warehouse, then between two native warehouses. Inspect actual Dolibarr movement records and QR location.
4. Check out and check in two items to an active employee, including auto-creation or reuse of their warehouse.
5. Consume a tracked item and partially consume a box, then return some/all consumed units. Test both native posting and already-posted modes against known initial stock.
6. Correct a known box quantity upward and downward. Establish an initially unknown quantity and confirm that this first baseline does not silently add stock.
7. Link consumption to a real shipment or MRP record and verify the operator can select the correct native-stock posting mode.
8. Interrupt a native movement and test reconciliation with complete evidence, no evidence and conflicting/partial evidence.
9. Verify permission denials, duplicate scans, consumed-item restrictions, generic batch registration at max batch size, mobile scanner fallback and browser back/repost behavior.

### Known limits

- No live Dolibarr/Binloc integration test was possible here; treat this as **staging-ready source, not production-validated**.
- Creating/selecting exact Dolibarr lot/serials for generic QR units or counted containers is not implemented. Automatic native mutations for lot-managed stock require extra modeling.
- This is not a full stock-count/reconciliation UI. The correction page handles **one known box quantity** at a time.
- Batch checkout/in and stock moves are not one all-or-nothing business transaction; errors are reported per QR.
- Camera scans save a cropped QR snapshot; hardware/manual scans display a generated QR image. No general product-photo upload subsystem is included.
- Native shipment/MRP stock deduction is **not** automatically detected. Select `Already deducted by Dolibarr` when appropriate.
- Keep `state.json` private and backed up. It contains the complete serialized inventory and movement history.


## v2.6.4 Firefox camera fallback

- **Scan QR**, **Register**, **Move**, **Checkout**, **Check in** and **Consume** share the same camera engine.
- Prefer `BarcodeDetector`; where missing or failing, decode `getUserMedia` frames with jsQR 1.4.0 in the browser, without sending images to any server.
- jsQR is fetched only as needed from the pinned URL `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js`. This requires internet access and an applicable browser Content-Security-Policy; it exposes the page to third-party JavaScript. For a controlled internal deployment, place the reviewed jsQR distribution in `assets/vendor/jsQR.js`; the module selects it automatically when present.
- The Serialised Unique path retains the immediate details form and cropped QR thumbnail with either decoder.
- Regression tests exercise native and fallback decoding as well as standalone camera navigation.


## v2.6.5 extended QA

- Firefox camera permission is requested directly from the user's click, before the optional
  JavaScript decoder download. The camera is released if the decoder cannot load.
- `tests/test_http_inventory.py` exercises actual HTTP forms against a **persistent native-stock
  fixture**, including stock transfers, employee warehouse creation and returns,
  manufacturing/sales order references, quantity corrections and failure cases. The fixture
  reproduces the Dolibarr 21 stock API contract but is not a real Dolibarr installation.
- Run every local suite with `sh tests/run_all.sh` from the module folder.
- Consult `TEST_REPORT.md` for coverage, restrictions and live staging checks.
- **Not yet validated on a real Dolibarr server or Firefox camera.** External DNS and
  interactive browser access are restricted in the execution environment.


## Local Binloc labels (v2.6.6)

Open **Local Binloc labels** from the QR Router menu. Select a warehouse,
then choose which Binloc levels appear on local labels and optionally set the
separator before each level. An empty separator joins adjacent values directly.

Use this where other warehouse signs already identify higher-level locations,
for example omitting the aisle/rack from a bin-content sheet displayed within
that aisle/rack. The actual Binloc level selections and full stored `bin`,
`bin_key` and `bin_values` are **not altered**. Short labels need not be unique
throughout the warehouse; full codes are retained and shown in small text for
context, and stock transactions still use the full location.

### Manual entry and camera context (v2.6.11)

When switching from a scan workflow to **Enter codes manually**, **Back to ... camera** returns to the same operation. This includes registration mode and Copy template, stock actions (Move, Checkout, Check-in, Consume), and destination-box scans with their source box. The manual review screen also provides this return link.

### Localisation (v2.6.13)

The module includes `langs/en_US`, `langs/nl_NL`, and `langs/fr_FR`. Dolibarr selects the language via the user account. Labels for the item types are **Tracked Individual**, **Tracked Generic**, and **Counted Container**; stored type keys (`tracked`, `generic`, `box`) are intentionally unchanged. The UI dictionary translates navigation, registration, inventory, stock operations, common camera/scanner messages and search/review prompts. Dolibarr chooses the locale from the logged-in user. Some uncommon validation and backend error messages remain in English as a fallback.

### Six-character identifiers (v2.6.14)
New unassigned QR labels are six characters long. The first five are randomly selected from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (excluding 0, 1, I, L, and O). The last is a deterministic modulo-31 check character. Manual entry and camera scans reject invalid check digits. Existing 10-character and prefixed labels are retained, and printing does not alter Dolibarr stock. Codes are identifiers, not security credentials.
