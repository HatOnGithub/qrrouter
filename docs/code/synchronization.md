# Synchronization and recovery

QR state and native stock live in separate databases. The service durably stores intent before PHP changes Dolibarr. PHP then returns native evidence so C# can finalize the QR state. This is a recoverable protocol, not a distributed database transaction.

## Native candidate synchronization

Creation, bulk creation, registration, initial counts and container-content transfers can use the `native-stage` / `native-finish` protocol when native-linked records are involved.

1. PHP prepares allowed fields from native products, warehouses and creation rules. It checks action and stock rights, plus lot-creation rights when needed.
2. `InventoryService.NativeStage()` applies the proposed command to a cloned state. It records before/after changes, candidate item/batch snapshots and the result under root `pending_native`, with a random `QRR-N-...` ID.
3. That service transaction commits before native execution. While the root intent exists, other modifying service commands are blocked except native finish/cancel.
4. `qrr_native_complete()` checks current rights and visibility of both sides. If there is no native receipt, it starts a Dolibarr transaction and inserts a unique receipt claim for the entity/operation ID.
5. Native stock rows are locked in product order, lot identities are resolved/created, expected quantities are checked and native `correct_stock_batch()` calls apply the required deltas. The lot-ID bindings are saved into the same receipt transaction.
6. After the native commit, PHP sends `native-finish` with the operation ID and bindings. C# installs the staged snapshots, attaches native lot IDs, removes `pending_native` and returns the saved result.

The committed receipt is the durable evidence used if PHP lost a response after stock commit. The unique key also prevents concurrent recoveries from independently applying the same candidate. An uncommitted receipt claim is not proof of stock completion.

Registration of an existing native lot links matching stock rather than receiving it again. Registering a new generated tracked serial can instead receive a new unit. Existing serial linking and new receiving are explicit intent flags; do not infer the distinction from a browser-supplied quantity.

Native-linked metadata edits use the metadata command path. They do not repost stock or rename a native lot/serial identity.

### Recovery and cancellation

The browser's Recover command returns to `qrr_native_complete()`. A saved committed receipt skips stock execution and supplies the same bindings to service finalization. Cancel is allowed only if there is no committed native-change receipt. PHP writes a cancellation receipt before C# removes the intent, preventing later completion of an operation that was cancelled. Recovery/cancellation require Recovery and the original action grant, stock rights and current native visibility.

The gateway waits at least 30 seconds from staging before manual native recovery/cancellation. The service also enforces the native cancellation delay. This delay reduces overlap with an original request still executing; elapsed time alone is not evidence that stock did or did not commit.

## Per-item inventory workflows

Move, consume, return and quantity correction use `plan`, `stage`, `finish` and `reconcile`. Employee loans use corresponding `handoff-*` commands and transfer-specific evidence.

1. C# plans from the current item and trusted native observations. A plan has only the allowed QR patch, signed warehouse effects, identity/reference data and the current revision.
2. PHP preflights native stock availability, warehouse state and lot requirements.
3. `Stage()` checks that the revision still matches, replans under the write transaction and assigns a random `QRR-...` operation ID. It persists `pending_operation` or `pending_handoff` before native execution.
4. PHP executes native stock APIs in a Dolibarr transaction, tagging movements with that operation's `inventorycode`.
5. PHP queries movement evidence by that ID, product, lot, warehouse and delta. The service verifies the operation ID and the complete expected evidence before applying the QR patch/loan state and clearing the marker.

A QR-only operation with no native effects and no native lot identity can apply immediately during staging. A native-linked location-only change can still retain a pending operation even when there are zero stock deltas.

### Evidence outcomes

| Evidence                                                   | Normal finish                                                    | Manual reconcile after delay                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Each expected movement exactly once, no unrelated movement | Apply intended QR result and clear intent                        | Same                                                                            |
| No expected or unrelated movements                         | Reject incomplete finish, except an empty effect set is complete | Clear the operation without applying the patch when there were expected effects |
| Missing half, duplicates or unrelated movements            | Reject and retain intent                                         | Reject and retain intent for investigation                                      |

For loans, complete evidence means one matching outgoing and one matching incoming movement, with no extras. Checkout records the original location; checkin restores it after the verified transfer. A browser cannot provide trusted proof: PHP queries native movements and constructs it.

## Whole physical bin moves

`PhysicalBins.StartMove()` fixes the target/member set and marks every member with `pending_bin_move`. PHP processes members through the ordinary item move protocol. Completed members remain complete if a later member fails. Resume skips members already at the target, reconciles uncertain item operations as needed and continues the fixed move. `FinishMove()` updates the bin location and releases locks only after every member has finished at the target.

This is intentionally resumable across per-item transactions. It does not make every native movement in a whole bin atomic.

## Failure cases

| Failure point                                                         | Retained state / next step                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Validation or preflight before staging                                | No durable stock intent from that failed request; correct the input               |
| Native failure after staging                                          | Intent remains; inspect and recover/reconcile rather than submitting a new action |
| Native commit succeeded, service finish response lost                 | Receipt or movement evidence determines completion; do not post stock again       |
| Stock evidence conflicts or native identity/warehouse is inaccessible | Keep intent and investigate native records/access; do not force the patch         |
| Permissions revoked after staging                                     | Finalization must obtain the necessary grants before it can proceed               |
| Some bin members completed                                            | Resume remaining members; preserve completed results                              |

The **More details** foldout describes requested values and movements. It is not commit evidence. Avoid recovery code that treats network failure, a missing browser response, an empty UI table or a timeout as proof of rollback.
