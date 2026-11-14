# Source map

Paths below are relative to the repository root. Generated bundles, dependency directories and EF designer/snapshot files are not the primary places to edit behavior.

## C# business service

| Source                                                                                                                                    | Responsibility                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Program.cs](../../src/QrRouterApi/Program.cs)                                                                                            | Startup, external configuration, validation, DI, middleware and health route                         |
| [InventoryController.cs](../../src/QrRouterApi/Controllers/InventoryController.cs)                                                        | Private HTTP contract and actor headers                                                              |
| [Actor.cs](../../src/QrRouterApi/DTO/Actor.cs)                                                                                            | Trusted caller context and independent grants                                                        |
| [ApiKeyMiddleware.cs](../../src/QrRouterApi/Middlewares/ApiKeyMiddleware.cs)                                                              | Server-client authentication and no-store/nosniff headers                                            |
| [ErrorHandlerMiddleware.cs](../../src/QrRouterApi/Middlewares/ErrorHandlerMiddleware.cs)                                                  | Domain/argument/error status mapping                                                                 |
| [AppSettings.cs](../../src/QrRouterApi/Helpers/AppSettings.cs), [Json.cs](../../src/QrRouterApi/Helpers/Json.cs)                          | Persistent-path validation and JSON domain helpers                                                   |
| [StateRepository.cs](../../src/QrRouterApi/Repositories/StateRepository.cs)                                                               | Entity initialization, reads/updates, document/record conversion and scoped history SQL              |
| [InventoryDbContext.cs](../../src/QrRouterApi/Repositories/InventoryDbContext.cs)                                                         | EF records, JSON checks, computed warehouse column and index                                         |
| [InventoryDesignFactory.cs](../../src/QrRouterApi/Repositories/InventoryDesignFactory.cs), [Migrations](../../src/QrRouterApi/Migrations) | Isolated design-time model and versioned schema changes                                              |
| [InventoryService.cs](../../src/QrRouterApi/Services/InventoryService.cs)                                                                 | Capabilities, creation/editing, native observations, plan/stage/finish protocols and state mutations |
| [Creation.cs](../../src/QrRouterApi/Services/Creation.cs), [Codes.cs](../../src/QrRouterApi/Services/Codes.cs)                            | Pure creation preparation and QR/checksum generation                                                 |
| [Locations.cs](../../src/QrRouterApi/Services/Locations.cs)                                                                               | Internal levels/options, canonical assignments, formatting and one-time import                       |
| [InventoryQueries.cs](../../src/QrRouterApi/Services/InventoryQueries.cs)                                                                 | Reports, allocation and other read models                                                            |
| [PhysicalBins.cs](../../src/QrRouterApi/Services/PhysicalBins.cs)                                                                         | Movable bin identity, membership and fixed resumable moves                                           |
| [PickLists.cs](../../src/QrRouterApi/Services/PickLists.cs)                                                                               | Saved requirements, consumption-derived progress and manual completion                               |
| [ActionHistory.cs](../../src/QrRouterApi/Services/ActionHistory.cs)                                                                       | Safe saved audit summaries and legacy projection                                                     |

## Dolibarr entry points

| Source                                                                                                                                   | Responsibility                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [api.php](../../dolibarr/qrrouter/api.php)                                                                                               | Same-origin reads/commands, CSRF, capability dispatch and native orchestration |
| [app.php](../../dolibarr/qrrouter/app.php), [index.php](../../dolibarr/qrrouter/index.php)                                               | Module entry and Angular host                                                  |
| [admin/setup.php](../../dolibarr/qrrouter/admin/setup.php)                                                                               | Administrator service connection settings                                      |
| [modQrrouter.class.php](../../dolibarr/qrrouter/core/modules/modQrrouter.class.php)                                                      | Module metadata, dependencies, rights, menus and SQL installation              |
| [actions_qrrouter.class.php](../../dolibarr/qrrouter/class/actions_qrrouter.class.php), [native.php](../../dolibarr/qrrouter/native.php) | Native card hooks and related QR views                                         |
| [label.php](../../dolibarr/qrrouter/label.php), [batch_print.php](../../dolibarr/qrrouter/batch_print.php)                               | Authorized individual/batch print data                                         |
| [bin_print.php](../../dolibarr/qrrouter/bin_print.php), [physical_bin_print.php](../../dolibarr/qrrouter/physical_bin_print.php)         | Storage-location and movable-bin printouts                                     |
| [qr.php](../../dolibarr/qrrouter/qr.php), [thumbnail.php](../../dolibarr/qrrouter/thumbnail.php)                                         | Authorized QR image and thumbnail delivery                                     |
| [Native receipt SQL](../../dolibarr/qrrouter/sql/llx_qrrouter_native_receipt.sql)                                                        | Entity/operation receipt identity and persisted bindings                       |

## PHP library roles

Barcode rendering uses [barcode.php](../../dolibarr/qrrouter/barcode.php) and `qrrouter_barcodes.lib.php`; [qr.php](../../dolibarr/qrrouter/qr.php) remains the PNG compatibility entry point. The supported carriers share [barcode-formats.json](../../dolibarr/qrrouter/assets/barcode-formats.json). See [barcodes and layouts](barcodes.md) for identity and rendering boundaries.

All libraries are under [`dolibarr/qrrouter/lib`](../../dolibarr/qrrouter/lib).

| Library                            | Responsibility                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `qrrouter.lib.php`                 | Shared bootstrap helpers, tokens, QR validation, native catalogs, employee mappings and layout                |
| `qrrouter_security.lib.php`        | Base/action/native object permissions, history visibility and safe browser/pending projections                |
| `qrrouter_service.lib.php`         | Validated connection settings, private transport, trusted headers, observations and native preflight          |
| `qrrouter_creation.lib.php`        | Allowlisted create/edit/bulk preparation and trusted product serial prefixes                                  |
| `qrrouter_native.lib.php`          | Lot/serial resolution, live observations, candidate synchronization, transactional receipts and cancellation  |
| `qrrouter_workflows.lib.php`       | Workflow orchestration, movement evidence, native effects, physical-bin visibility and consumption references |
| `qrrouter_checkout.lib.php`        | Employee transfer execution and outgoing/incoming evidence                                                    |
| `qrrouter_locations.lib.php`       | Native warehouse/location adapter and storage-location QR payload resolution                                  |
| `qrrouter_location_import.lib.php` | Optional one-time Binloc import                                                                               |
| `qrrouter_extra.lib.php`           | Trusted order lines, allocation/report query preparation                                                      |
| `qrrouter_product_search.lib.php`  | Plain-text visible tags and searchable product extra fields                                                   |
| `qrrouter_related.lib.php`         | Native target checks, routes and related-item filtering                                                       |
| `qrrouter_labels.lib.php`          | Shared label/print preparation                                                                                |
| `qrrouter_print.lib.php`           | Print locale and translation support                                                                          |
| `qrrouter_thumbnails.lib.php`      | Bounded image decoding and entity-scoped thumbnail storage                                                    |

## Frontend, tooling and tests

The [frontend guide](frontend.md) maps every feature and shared control. Entry points are [`frontend/src/app`](../../frontend/src/app), public models/services are under `core`, reusable controls under `shared`, pages under `features`, and standalone label code under [`frontend/src/print`](../../frontend/src/print).

[`tools`](../../tools) contains frontend deployment, packaging, explicit legacy import and portable test-runtime helpers. [`tests`](../../tests) contains the console service suite, HTTP/storage checks, PHP/native fixture integration and Dolibarr-version compatibility checks. [`frontend/dev`](../../frontend/dev) contains mock API/browser tests; [`frontend/e2e`](../../frontend/e2e) contains production-hosted browser tests. Workflow definitions under [`.github/workflows`](../../.github/workflows) connect these checks to CI and release packaging.

The [`reference`](../../reference) directory supplies project reference material. Downloaded compatibility sources, test data and built archives under `artifacts` are not runtime domain code.
