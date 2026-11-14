# Gateway and service contracts

## Browser gateway

The public application uses `dolibarr/qrrouter/api.php` under the current Dolibarr session. The endpoint applies base inventory authorization before dispatch. Reads use `GET ?resource=...`; commands use `POST ?action=...`. Normal reads return the resource directly. Successful commands return `{ "result": ... }`; errors return `{ "message": ... }` with a failure status.

The Angular `InventoryService` derives the gateway path from the host's `data-api` attribute, allowing installation under a custom Dolibarr path. Do not hardcode a service URL or service key into a component.

### Read resources

| Resource                             | Responsibility                                                               | Important inputs/checks                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bootstrap`                          | Public state, catalogs, permissions, tokens, translations and module context | Explicit browser projection and native observations                                           |
| `history`                            | Paged operation summaries                                                    | History grant; `code`, `q`, `event`, `user_id`, `from`, `to`, `page`; native visibility scope |
| `products`                           | Search permitted physical products                                           | Search query and product/object read access                                                   |
| `serial-check`                       | Validate an existing native serial selection                                 | Creation/edit rights and native identity visibility                                           |
| `levels`                             | Warehouse location definitions                                               | Visible `warehouse_id`                                                                        |
| `locations`                          | Location report and available location choices                               | Warehouse and optional location/level filters                                                 |
| `location-qr`                        | Resolve a scanned storage-location payload and current contents              | `payload`; entity, warehouse and level validation                                             |
| `physical-bins`                      | Visible movable bins and member codes                                        | Current/target warehouse and every member must be accessible                                  |
| `orders`                             | Sales-order lookup                                                           | Native order read and object access                                                           |
| `references`, `manufacturing-orders` | Permitted consumption reference lookup                                       | Reference type and native module/object access                                                |
| `picking`                            | Stock allocation proposal for an order/warehouse                             | Native order lines and visible candidate QRs                                                  |
| `pick-lists`                         | Saved visible sales-order pick-list progress                                 | Native sales-order access                                                                     |
| `print-translations`                 | Localized strings for print pages                                            | Supported language selection                                                                  |

These are application contracts, not generic database access. Inspect `qrr_api_get()` for resource-specific filters and response fields before extending a client.

### Commands

| Action family                                                        | Gateway behavior                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `create`, `bulk`, `register`, `update`                               | Prepare trusted fields, native serial generation/linking and location choices; select QR-only or native synchronization path        |
| `delete-unassigned`                                                  | Check visible QR and delete only an unused unassigned item                                                                          |
| `count`, `box-transfer`                                              | Validate container/count constraints and synchronize native lots where applicable                                                   |
| `workflow`                                                           | Dispatch move, consume, return, correct, checkout, checkin or transfer for selected codes; return per-code results where applicable |
| `reconcile`, `native-recover`, `native-cancel`                       | Load persisted operation and query native evidence/receipts; never accept browser proof                                             |
| `physical-bin-create`, `physical-bin-assign`, `physical-bin-move`    | Manage bin identity, metadata membership or resumable member moves                                                                  |
| `pick-list-save`, `pick-list-complete`                               | Load trusted order requirements or record manual completion with reason                                                             |
| `mapping`, `label-settings`, `location-configure`, `location-import` | Apply configuration/administrative checks and prepared configuration data                                                           |

Commands carry a form body containing `token` (Dolibarr's native token), `qrr_token` (the module's session token) and `payload` (JSON). `qrr_check_post()` validates the module token after native bootstrap checks. The gateway rejects payloads larger than 262144 bytes. It rebuilds command-specific data rather than forwarding the decoded object wholesale.

For an authorized browser client with a loaded bootstrap, a read can look like:

```ts
const history = await inventory.read('history', { code, page: 1 });
```

Writes go through the same browser service so both form tokens are included:

```ts
await inventory.command('workflow', {
  kind: 'move',
  codes: [code],
  warehouse_id: destinationWarehouse,
  levels,
});
await inventory.refresh();
```

This example supplies user choices, not a stock patch, effect list, revision proof or native movement receipt. PHP resolves those trusted fields. The caller must still review failures and pending state before retrying.

## Private C# service

The ASP.NET Core controller exposes `GET /api/inventory` and `POST /api/inventory/{command}`. The GET defaults to omitting history; `includeHistory=true` requires the export/history permission. POST accepts a JSON object and wraps the result. `/health` is the only unauthenticated service route.

`ApiKeyMiddleware` verifies `X-Api-Key`. The controller builds an `Actor` from trusted adapter headers:

| Header                       | Meaning                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `X-Qrr-Entity`, `X-Qrr-User` | Positive entity/user IDs                                         |
| `X-Qrr-Use`, `X-Qrr-Read`    | Base QR module/inventory access                                  |
| `X-Qrr-Permissions`          | Comma-separated independent action grants                        |
| `X-Qrr-Stock`                | Native stock-write capability                                    |
| `X-Qrr-History`              | Authorized operation-history access                              |
| `X-Qrr-Admin`                | Native administrator context after PHP session checks            |
| `X-Qrr-Manage`               | Configuration/legacy context; not a substitute for action grants |

Only the server-side adapter should send these headers. `qrr_service()` constructs them from `$user` and `$conf`, ignoring browser-supplied identity headers. Keep the private service on the trusted deployment network; it does not independently query Dolibarr permissions.

### Internal command families

`InventoryService.Execute()` is the dispatch contract. Domain commands include creation/edit/delete, counts/transfers, mappings/settings, locations, pick lists and physical bins. Query commands include location choices/levels/labels, bin and warehouse summaries, known bins, batches, picks, pick lists, physical bins and history.

`prepare-creation` and `validate` are non-persisting validation helpers. `plan` / `handoff-plan` read the state without committing a mutation. `stage`, `finish`, `reconcile`, `handoff-*`, `native-stage`, `native-finish` and `native-cancel` implement the [recovery protocols](synchronization.md). These internal commands are not a safe public browser API.

Trusted request fields such as `warehouses`, `users`, `products`, `native_items`, `visible_codes`, history `visibility`, native order `lines`, `choice`, `proof` and `bindings` must be constructed or checked by PHP. C# validates domain consistency but relies on the adapter for native authorization and evidence.

## Failures and dates

C# maps denied permission to 403, missing QR to 404, domain conflicts to 409 and malformed arguments/JSON to 400. Unexpected failures are logged and return a generic 500 message retaining pending operations. PHP maps its permission failures to 403, malformed requests to 400 and other operation failures to 409 unless an explicit response status is already set. The adapter does not promise to preserve every private-service status unchanged.

History dates use an inclusive `from` and exclusive `to`. The frontend converts chosen local calendar days into UTC boundaries, advancing the final selected day by one local day. Pass exact QR filters separately from free-text search. History page size is limited to 100 and validated by the repository.
