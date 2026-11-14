# Permissions and public projections

## Authorization is an intersection

The browser displays capabilities; PHP enforces the Dolibarr session, native rights and object access; C# enforces the trusted actor's QR capabilities again. Service possession of an API key identifies the trusted adapter, not an arbitrary browser user.

`qrr_inventory_right()` requires an active internal user, enabled QR Router/Product/Stock/Lot-Serial modules, QR module access/read and native product/stock read. Nonadministrators need both `use` and `read`. External or inactive users do not gain entry through an administrator flag. Independent write grants do not replace this base access.

Native `restrictedArea` checks enforce object scope in addition to broad rights. `qrr_native_read_access()` accounts for the explicit read-mode parameter in newer Dolibarr signatures. Product visibility, warehouse visibility, lot consistency, document access and employee access are rechecked where their records are used. Do not equate an entity ID or a successful catalog lookup with permission for every object in that entity.

## QR capability mapping

| Grant         | Browser operations / domain commands                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `use`, `read` | Enter module and read inventory                                                                            |
| `create`      | Create, bulk-create, register labels, create physical bins; also assign an unassigned label through update |
| `modify`      | Edit metadata; pack/unpack physical bin members                                                            |
| `delete`      | Delete unused unassigned QR labels                                                                         |
| `move`        | Move items and start/finish whole physical bin moves                                                       |
| `consume`     | Consume items, including guarded pick consumption                                                          |
| `return`      | Return recorded consumption                                                                                |
| `adjust`      | Count/correct containers and transfer contents between containers                                          |
| `loans`       | Checkout/checkin and resolution of employee warehouse mappings                                             |
| `picking`     | Save pick lists and manually complete them                                                                 |
| `print`       | Authorized label/report print endpoints                                                                    |
| `recover`     | Recover/cancel native synchronization and reconcile pending operations                                     |
| `manage`      | Configure locations and label settings; some administrative commands also require administrator status     |
| `history`     | Read operation history through the paged endpoint or permitted exports                                     |

`manage` is not a blanket action permission. The C# actor retains a legacy `Manage` field, but independent capabilities come from `Permissions`; old clients cannot turn that flag into write authority. PHP and C# use different routing names for some operations, so review both mappings when adding an action.

Recovery additionally checks the original action grant stored with the pending operation. A recover-only user cannot complete another workflow without its grant. C# repeats this check inside the write transaction so it uses the actual persisted operation. Metadata updates that assign an unassigned label require Create as well as Modify.

## Native rights remain required

Stock execution needs native `stock.mouvement.creer`. Creating a missing native lot or serial also requires native product-create permission. Existing-lot operations do not automatically require creation of a new product identity. Automatic employee warehouse creation requires native warehouse-create permission. History needs native `stock.mouvement.lire` as well as the custom history grant.

Order, manufacturing and shipment references have their own native read checks, including access to the specific record. User selectors are limited to permitted employees. Internal storage locations belong to QR Router; normal location use does not require the optional Binloc module.

QR media endpoints still require inventory/object access. Print endpoints additionally require Print. Hiding a button is a convenience; direct URLs and API requests must enforce the same rules.

## Public projections

`qrr_browser_inventory()` selects allowed fields explicitly. It filters inaccessible QR items and removes their codes from batches; product catalogs are restricted to the remaining items. Employee mappings, checkout details and consumption references are separately filtered. Free-text consumption reasons are removed when they may identify a restricted referenced document.

### Pending synchronization details

Pending metadata contains `id`, action/kind and time. Its optional `details` array has rows containing only `code`, `field`, `before` and `after`. `qrr_pending_change_details()` checks both sides of a native change before describing known public fields. `qrr_pending_operation_details()` also checks destination and movement warehouse visibility before describing a QR patch or signed stock effects.

Do not forward raw `changes`, candidate `items`, `patch`, `effects`, receipts, prices or proofs. New display fields need explicit projection rules and denial tests. An empty details list yields a generic unavailable message; it must not reveal restricted record identities. Details describe original intent, not evidence that the operation failed or committed. Inventory readers can inspect permitted pending intent without acquiring Recovery or History.

### Operation history

`ActionHistory.Project()` builds a compact saved summary with affected codes, operation/status, quantities, locations and reference identifiers. `StateRepository.History()` searches and pages summaries instead of returning audit contexts.

For nonadministrators, PHP supplies a current visibility scope containing QR codes, warehouses, physical bins and references. The SQL query requires every affected code and referenced object to be visible. Entries need `visibility_version = 1`; legacy audit entries lacking that metadata remain administrator-only. A history grant cannot reveal records hidden by native access rules. Exact per-QR filtering compares the identifier, rather than treating it as a free-text substring.

## Extending authorization

Add a new grant to the module descriptor, PHP permission keys/action mapping, forwarded actor permissions, C# mapping, bootstrap model and UI checks. If it uses native objects, add native access checks before staging and again during execution/recovery. Test granted and denied direct requests, forged browser identity headers, and loss of the original grant before finalization. Refresh installed module permission definitions and assign new grants during upgrades.
