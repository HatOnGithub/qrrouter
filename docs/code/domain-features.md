# Domain features

## Creation and registration

`Creation.Prepare()` is a pure preparation step for normalized names, native identities and random serials. PHP supplies the trusted product prefix and checks native availability. Generated tracked serials use that prefix plus random bytes; a browser prefix override does not become authoritative. The QR code and native serial are distinct identities.

`InventoryService` owns Make/Create/Bulk/Register/Edit, duplicate native-identity checks and the constraints on item types. Bulk operations are bounded; individual names and container identities are validated before a mutation commits. Registration turns an unused label into a typed item. Existing native serials/lot counts must match when linking; a new generated tracked serial may be received through the native protocol. Metadata-only edits of already linked records do not change native quantities or serial names.

Delete applies only to unused unassigned labels. It also removes their membership from label batches. It is not a native product deletion or a way to erase stock/history.

## Internal locations

`Locations.cs` owns per-warehouse levels, option identities, validation, canonical keys and display labels. Level types are text, number, letter or option list. Values must follow level order without gaps; unknown levels/options and invalid values are rejected. The unconfigured fallback is one free-text Location level. Formatting uses stored configuration, while assignments preserve stable IDs.

Configuration changes preserve existing level/option identities. Datatype changes are restricted once assignments exist. Both item and physical-bin assignments matter when deciding whether a definition can change. Renaming a display option does not mean generating a new identity for every item.

`qrrouter_locations.lib.php` is the native-warehouse adapter. It asks C# to validate choices and constructs storage-location labels in the format:

```text
QRRLOC:1:<entity>:<warehouse>:<base64url JSON level values>
```

The payload is tied to entity, warehouse and level values, not the current formatted label. Resolving it checks entity, visible warehouse and current definitions, then returns current contents through authorized summaries. Printed URLs carry this payload in the application route. Treat a scan as a request to resolve a location, not trusted stock or an unchecked destination.

The optional `qrrouter_location_import.lib.php` reads legacy Binloc data once into native QR Router definitions/assignments. Normal operation does not load Binloc classes. Import is limited to warehouses not already configured and must preserve pending-operation safety.

## Movable physical bins

A physical bin has its own permanent QR identity, label and current storage location. Its members are items whose `physical_bin_id` matches that bin. Packing and unpacking change membership only; they do not move stock. Packing requires available items already at the bin's current location.

Its scan payload is:

```text
QRRBIN:1:<entity>:<six-character bin ID>
```

Unlike a storage-location label, this identifies a movable object. Resolve it against the current entity and visible bin before using its location or contents.

`StartMove()` fixes a target and member list, preventing unrelated workflows from taking the marked members. Each member then uses the ordinary native stock move protocol. A cross-warehouse move needs known container counts. `ValidateMove()` allows only the matching active move and target. `FinishMove()` releases locks only when every fixed member has completed at the target. See [synchronization](synchronization.md#whole-physical-bin-moves) for partial completion and resume behavior.

## Picking and saved lists

PHP reads native sales-order or manufacturing requirements and permitted products. `InventoryQueries.Pick()` greedily allocates available items in natural location/code order. Containers contribute available units; tracked/generic entries contribute one. Missing allocations are explicit rows rather than invented inventory. Proposals do not reserve native stock.

Saved customer-order pick lists are keyed by order ID. `PickLists.Save()` captures the initial trusted requirements; calling it again returns progress rather than silently replacing the list. Progress derives from consumption logs and pending consumes referencing that sales order, across all warehouses.

`InventoryService.Plan()` recalculates the allowance when a guarded consume is staged. A QR outside the current proposal or a quantity exceeding the remaining allowance is rejected even if the browser previously displayed it. Pending consumption counts toward the allowance so overlapping requests cannot both spend it. Queries must retain the full order-wide consumption data even when candidate visibility is narrower.

Manual completion requires a saved open/in-progress list, no pending picks, the Picking grant and a nonempty bounded reason. It records completion metadata and outstanding lines. It does not create native stock movements or fabricate consumption records. A manually completed list no longer proposes additional picks.

## Queries, consumption and loans

`InventoryQueries` owns read-model aggregation. Bin reports distinguish individual tracked entries from per-product generic/container totals and unknown container counts. Pending/unavailable records are excluded from usable totals. PHP overlays native observations and passes visibility constraints to avoid counting inaccessible records in public summaries.

Consumption and returns append quantity/reference entries used in QR details and picking. References can point to permitted sales orders, manufacturing orders or shipments. Server-side reference checks are required even if a selector only offered allowed values earlier.

Employee checkout/checkin transfers stock through personal warehouses. An administrator can configure mappings; resolving an absent mapping may create a native employee warehouse only with the corresponding native permission. Checkout preserves original location fields, and checkin restores them after native transfer evidence is verified.

## History and pending details

Every successful repository update stores an audit record with actor, action, time, revision and projected summary. A multi-step stock action can therefore produce several lifecycle entries, such as stage and finish. This history describes QR Router operations; it is not a replacement for the complete native Dolibarr stock ledger.

The same `HistoryComponent` serves `/history` and an embedded QR details panel. An exact QR filter isolates the item's entries. The grant, native movement-read right and current native object scope all apply to both views.

Pending notices instead display the currently retained requested changes through `PendingDetailsComponent`. That foldout is informational and available to inventory readers for permitted records. It neither grants recovery nor proves whether native changes have committed. See [public projections](permissions.md#public-projections) for its safe DTO.
