# State and persistence

## Item identity and types

An item's QR `code` is its key in `items`. Newly generated codes contain five random characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` and one rolling checksum character. C#, PHP and TypeScript also accept the supported legacy identifier formats. A code is an identifier, not an authorization token.

| Type         | Meaning                                          | Quantity and native identity                                                                                 |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `unassigned` | A printed label waiting for registration         | No assigned stock identity; eligible for deletion while unused                                               |
| `generic`    | A QR entry for a product unit                    | Domain workflows treat the entry as a unit; it does not require its own native serial                        |
| `tracked`    | An individual with a native serial               | Native stock for the serial must be zero or one                                                              |
| `box`        | A counted container associated with a native lot | A known nonnegative whole-unit count is needed for native stock operations; legacy unknown counts use `null` |

Do not coerce an unknown quantity to zero: zero means a known empty container. The service rejects unsupported quantity ranges and fractional QR stock quantities where native stock is observed.

Common fields include `label`, `product_id`, `warehouse_id`, `qty`, `serial`, `native_batch`, `product_lot_id`, `details`, `created_at` and `updated_at`. `status` and `consumed_units` describe consumption/return state. `checkout` records the employee and original location for a loan. `consumption_log` records consume/return quantities and references; it also supplies order-picking progress.

For a linked lot or serial, the native identity is protected from metadata renaming. Native lot stock split across warehouses is reported as a conflict rather than summarized as though one QR could occupy multiple warehouses.

## Locations and membership

`warehouse_id` identifies a native warehouse. Internal storage locations have three coordinated fields:

- `bin_values`: stable level IDs mapped to option IDs or scalar values.
- `bin_key`: canonical comparison key, independent of label formatting.
- `bin`: human-readable formatted location.

Location rules belong to the service. Call `Locations.Choice` through the adapter instead of constructing these fields from a browser string. `physical_bin_id` is membership in a movable physical bin; it is distinct from the storage location. See [domain features](domain-features.md).

## State document and collections

The service operates on a schema-2 JSON document even though storage is relational. `schema` and monotonically advanced `revision` are root metadata. The repository's `Maps` list stores these keyed collections as individual records:

| Collection                | Key                   | Purpose                                             |
| ------------------------- | --------------------- | --------------------------------------------------- |
| `items`                   | QR code               | Item state and item-level pending operations        |
| `batches`                 | Batch ID              | Printed/created groups of QR codes                  |
| `personal_warehouses`     | Employee ID string    | Employee-to-native-warehouse mapping                |
| `location_label_settings` | Warehouse ID string   | Location display/label preferences                  |
| `location_levels`         | Warehouse ID string   | Level definitions, option identities and formatting |
| `pick_lists`              | Sales order ID string | Saved order requirements and completion metadata    |
| `physical_bins`           | Physical bin ID       | Bin identity, current location and resumable move   |

Other root properties, including `pending_native`, are metadata records. `history` is stored separately in append-only audit rows. Normal HTTP inventory reads omit accumulated history. Export-style reads can request it with the required permission; the history screens use a paged query instead.

## Durable pending state

| Marker                                         | Scope                              | Stored intent                                                                                      |
| ---------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Root `pending_native`                          | Entity-wide native synchronization | Operation ID/time/action, per-code before/after changes, candidate item/batch snapshots and result |
| Item `pending_operation`                       | One inventory workflow             | Kind, ID/time, expected stock effects and allowed QR patch                                         |
| Item `pending_handoff`                         | One employee transfer              | Borrower, source/target warehouses, quantity and movement intent                                   |
| Bin `pending_move` and item `pending_bin_move` | Whole physical bin move            | Fixed target and frozen member codes, plus membership locks                                        |

These structures are recovery material. Raw snapshots, effects, patches and proofs do not form the browser API. The browser receives explicit metadata and safe summary rows described in [permissions](permissions.md#public-projections).

## SQLite representation and transactions

Each entity uses `<DataDirectory>/entity-<id>/state.sqlite3`. `records` has composite key `(collection, key)` and a JSON `document`. A stored computed `warehouse_id` column and an index on `(collection, warehouse_id)` support warehouse selection. `history` has a numeric ID and a JSON document. The EF model enforces JSON validity.

`StateRepository.Read()` runs its multiple queries in a deferred transaction, giving them one WAL snapshot. Warehouse-limited reads include both indexed cached items and codes observed by PHP in the requested warehouse, because native stock may have moved since the last stored QR update. Partial selections are for read models; writes load the complete entity state.

`Update()` loads state without accumulated history, runs the domain callback, increments `revision`, builds an audit summary, saves records and appends new history rows before committing. `Save()` removes records absent from the complete document. Never pass a warehouse-limited document to `Save()` or use a read callback as a persistence mechanism.

SQLite uses WAL and `synchronous=FULL`; new non-Windows entity directories and files receive restricted owner permissions. These durability settings do not replace backups of the QR database and native Dolibarr data together.

## Initialization and migration

The first access to each entity creates/opens the database, rejects unknown newer migration history, applies EF migrations and imports legacy `state.json` if the state has not been initialized. Migration and legacy import are separate retryable steps. The legacy source is retained; a failed import leaves no initialized-state marker. The old `binloc_label_settings` state name is normalized during validation.

The JSON schema number and EF migration history describe different contracts: one is the document format, the other is the database structure. Change neither casually. New state collections require reviewing `Maps`, defaults, `Load`, `Save`, validation, exports and tests. Database model changes additionally require a versioned migration and updated snapshot. See [maintenance](testing-and-maintenance.md#database-changes).
