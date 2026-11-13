# QR Router security review

Reviewed 9 November 2026. Scope: the PHP module/gateway, native lookups and print/media endpoints, Angular responses and links, the private C# API and state files, development mocks, and CI. Findings below have been remediated in this working tree. Deploy the rebuilt PHP module, Angular bundles and C# service together.

Location policy updated for v0.3.9 on 13 November 2026 to reflect service-owned locations and the optional Binloc importer. The review date and historical verification results below remain unchanged.

## Findings and fixes

| Severity | Finding | Remediation |
| --- | --- | --- |
| High | Module/product checks allowed stock data without native Stock read permission. Service-only permission also satisfied a physical-product check. External users and disabled modules were not consistently rejected. | A common policy now requires an active internal user, enabled module/dependencies, QR read/manage, physical Product read and Stock read. Every app, API, print and media endpoint enforces it. |
| High | Order/reference lists, picking and reference submission checked module-level rights without enforcing the native object's customer/entity visibility. | Lookups, selection validation, picking and saved-reference resolution call Dolibarr's `restrictedArea` in its non-terminating object-check mode, in addition to module read rights and entity scope. |
| High | Bootstrap serialized the service snapshot. Audit contexts, operation patches/proofs, opaque fields and raw consumption references could cross the browser boundary. | An explicit browser projection omits internal audit history and unknown fields, reduces pending operations to status metadata, and strips inaccessible reference IDs/types and their associated reason text. The frontend no longer reconstructs document links from unresolved IDs. |
| High | Native product metadata could be fetched from cached IDs without consistently checking the product's accessible entities. Aggregations could reintroduce filtered records and internal fields. | Product/lot/warehouse scope is checked before presentation and mutation. Synchronization recovery/cancellation rechecks both sides of every change, including retries with a committed native receipt. Aggregations receive an adapter-generated visible-code list. Tracked bin-summary rows are rebuilt from the authorized projection. Batch code lists and media access use the same visible records. |
| Medium | Managers could enumerate employees without native user-read permission; loan/mapping fields and logins could reveal additional user information. | The user directory requires native user-read access, with self-access retained. External/inactive employee choices are excluded; native object checks apply to other users. Borrowers and mappings outside that directory are redacted. `MAIN_ENABLE_LOGINS_PRIVACY` is respected. |
| Medium | Binloc fields and level configuration were served without Binloc read permission. | Locations are now service-owned: inventory read controls their projection, QR management controls edits, and the optional Binloc import requires administrator access. Native stock permissions remain separate. |
| Medium | QR/thumbnail endpoints had weaker checks than the app and permitted short-lived caching. | Media uses the same inventory/object policy and `no-store`. Native print responses and the private service also disable caching. |
| Medium | An administrator could change the service URL while retaining a saved, undisplayed API key, causing it to be sent to another endpoint. | Changing the URL requires re-entering the key. Ordinary saves with the same URL still preserve a blank key field. |
| Medium | Unix state files could inherit permissive directory/file modes. | Entity directories are restricted to their owner (`0700`), with state and lock files `0600`. Existing data is tightened on access. Windows continues to use deployment ACLs. |
| Low | Some native failures appended database/native diagnostic strings to browser messages. | Detailed failures are logged server-side; public messages retain a short operation description. Unexpected PHP runtime errors use a generic response. |

Primary implementation: [authorization and projection](dolibarr/qrrouter/lib/qrrouter_security.lib.php), [gateway](dolibarr/qrrouter/api.php), [native query filtering](src/QrRouterApi/Services/InventoryQueries.cs), [state storage](src/QrRouterApi/Repositories/StateRepository.cs).

## Access policy after remediation

- Basic inventory requires QR read/manage, Product read (`produit.lire`) and Stock read (`stock.lire`). Administrator status does not bypass the internal-user/active-module boundary.
- QR management does not grant native stock movement, product creation, user-directory or commercial-document permissions. Existing native write checks remain in place.
- Service-owned locations require inventory read access to view and QR management to change. The optional Binloc importer requires administrator access; normal location operations do not access Binloc or write its data.
- Other employee records require native user-read permission; the current user may see their own record. The browser receives no salary, email, API-key or user-permission records. Warehouse labels remain stock data and can themselves contain employee names, as on native warehouse cards.
- Saved customer orders, manufacturing orders and shipments are shown only when the current user can access that native record. Unknown or inaccessible references are not turned into fallback links.
- QR names, details and general unlinked purpose text are QR-domain fields covered by the inventory read permission. This review does not attempt to identify arbitrary sensitive text typed into those fields. Text attached to an inaccessible saved reference is redacted.
- Internal audit contexts and native operation intents remain in the private service for recovery; they are not frontend view models. Browser-supplied actor/permission headers and trusted-fact payloads cannot override the Dolibarr session.

## Verification

The PHP gateway tests now exercise direct requests for missing QR/Product/Stock rights, location management and optional importer access, service-only readers, external users (including an external administrator), inactive/anonymous users, disabled dependencies, restricted customer orders, hidden employee/loan fields, raw reference suppression, opaque/audit/pending-operation markers, foreign product entities, media denial, forged actor headers and service-URL/key preservation. Rejected attempts are checked for absence of inventory mutations.

The C# runner checks filtered read models and existing entity/actor/native-stock boundaries. Unix file-mode assertions run on Unix, including the new GitHub Actions gateway job. Local validation on Windows also passed the HTTP authentication/isolation smoke suite and the PHP integration suite. The rebuilt Angular app passed its 26 PHP-hosted browser tests and all 22 mock browser tests, including a new restricted-reader case aligned with the redacted browser contract.

`npm audit --json` reported zero known advisories for the locked frontend dependency tree on the review date. This is a point-in-time dependency check, not a claim about all possible vulnerabilities.

CI now runs both mock frontend checks and the real PHP/C# authorization fixture. Permission regressions do not depend solely on the development mock's approximation of Dolibarr.

## Sources and limits

Native permission behavior was inspected in Dolibarr **21.0.2**: [stock card](https://github.com/Dolibarr/dolibarr/blob/21.0.2/htdocs/product/stock/card.php), [lot card](https://github.com/Dolibarr/dolibarr/blob/21.0.2/htdocs/product/stock/productlot_card.php), [user card](https://github.com/Dolibarr/dolibarr/blob/21.0.2/htdocs/user/card.php), [customer order list](https://github.com/Dolibarr/dolibarr/blob/21.0.2/htdocs/commande/list.php), and [native object checks](https://github.com/Dolibarr/dolibarr/blob/21.0.2/htdocs/core/lib/security.lib.php). The [Binloc module descriptor](https://github.com/zacharymelo/binloc/blob/main/module/core/modules/modBinloc.class.php), reporting version 2.19.1 at review time, defines the `read`, `write` and `admin` rights used by the former integration. Normal location operations no longer depend on Binloc; only the optional importer reads its existing data.

Tests use Dolibarr native fixtures and optional legacy-import fixtures and a real PHP/C# transport, not a production database. Multicompany sharing, custom permission hooks, installed plugin modifications and the actual server's user/group assignments still need a staging check with representative accounts. The live server, reverse proxy, operating-system ACLs, Dolibarr core security updates and PHP/.NET/container-image patch levels were not audited.

The C# API intentionally trusts the PHP adapter's identity headers after authenticating its API key. That key is a privileged server credential: the service must remain private, and possession of it allows acting as the adapter. Keep it out of Angular/browser configuration and use a protected network/TLS when crossing hosts. This review does not certify an installation as vulnerability-free.
