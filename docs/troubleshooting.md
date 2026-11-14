# Troubleshooting QR Router

[Project overview](../README.md) · [Installation](installation.md) · [Updating](updating.md) · [User guide](user-guide/README.md)

Start with the exact message below. If a stock action failed or timed out, let the original request finish and keep any pending synchronization. A missing browser response does not prove that the stock movement failed.

## Native receipt table unavailable

**Message:** `Native receipt table unavailable. Re-enable QR Router to install its tables.`

QR Router could not read the Dolibarr table that records completed native stock transactions. That table makes recovery safe after a lost response. Replacing the module files does not run its table installer.

1. Sign in as an internal Dolibarr administrator.
2. Open **Setup > Modules/Applications**, disable QR Router, then enable it again. Keep the module's data and connection settings.
3. Refresh QR Router. If a synchronization is pending, follow the recovery steps below.

If the error remains, check the activation result and Dolibarr/PHP logs. Confirm that the installed module contains `sql/llx_qrrouter_native_receipt.sql` and that Dolibarr's database account can create the table. The table uses your configured database prefix; `llx_` is the default. This error can also indicate a query or permission failure when the table exists. Keep existing receipt rows; they are needed to distinguish committed stock changes from uncommitted work.

## Warehouse missing or closed

**Message:** `Warehouse missing or closed`, sometimes followed by `Pending synchronization retained; use Recover synchronization.`

The operation could not validate its warehouse. Check the selected warehouse and, for transfers, both source and destination in Dolibarr. Confirm that the intended warehouse still exists, is open and belongs to the correct entity. Reopen it only if it should remain in use.

If the warehouse is already open, check the installed QR Router version. **v0.3.7.1 checks the wrong warehouse status property on older Dolibarr releases, including 21.0.2.** Those releases populate `Entrepot::statut`; the newer `status` alias can remain unset. This can incorrectly reject an open warehouse. **v0.3.8 fixes this:** it prefers `statut`, falls back to `status` for objects exposing only the newer property, and rejects warehouses with no known status. Stock preflight, transfers, employee handoffs and synchronization recovery share this check. See the [v0.3.8 release notes](releases/v0.3.8.md).

After correcting the warehouse or installing the compatibility fix, refresh and select **Recover synchronization** for the retained operation. If the stored operation references a deleted or intentionally closed warehouse, ask the administrator to review it. **Cancel uncommitted synchronization** is available only when no native transaction committed; after a successful cancellation, submit a corrected operation. Do not edit the pending record or native stock merely to bypass validation.

## Pending synchronization or an uncertain stock result

Expand **More details** in the synchronization banner or the item's pending-operation notice to inspect the requested changes. The table shows intent; it does not confirm whether Dolibarr has committed the changes.

1. Wait for the original request to finish and allow at least 30 seconds before recovery.
2. Resolve the displayed cause, such as the missing table, unavailable service or warehouse validation error.
3. Select **Recover synchronization**. Recovery uses the original operation and its native receipt, including when stock already committed.
4. Refresh and verify the item quantity, warehouse, native lot/serial and operation result.

Use **Cancel uncommitted synchronization** only when appropriate; the module rejects cancellation of a committed native transaction. For an individual item's pending operation, open its details and select **Reconcile pending operation** when available. For a batch with mixed results, resolve failed rows individually and retain completed results. See [Setup and help](user-guide/help.md) for the interface steps.

## QR service unavailable or authentication rejected

1. Check the business service process or container. For Compose, run these commands from the existing deployment directory, retaining your usual project name and Compose files:

   ```sh
   docker compose ps qrrouter-api
   docker compose logs --tail=100 qrrouter-api
   ```

2. Check `/health` at the configured service address. With the default host port, this is `http://127.0.0.1:5087/health`. A successful health check confirms that the service is running; it does not verify the API key or PHP's network route to it.
3. Confirm that **Service URL** in QR Router's module setup is reachable from the Dolibarr PHP process. In a container, `127.0.0.1` refers to that container. On a shared Docker network the service address is typically `http://qrrouter-api:8080`.
4. Confirm that the saved **Service API key** matches the service configuration. Leaving an already saved key blank keeps it only when the URL is unchanged; re-enter it when changing the URL.
5. For `QR Router requires PHP cURL`, install or enable cURL in the PHP runtime serving Dolibarr and restart that runtime as needed.

After reconnecting, check pending operations before submitting stock actions. Keep API keys out of screenshots, browser configuration, shared logs and support requests.

## Service fails to start or inventory is unexpectedly empty

Check the service logs for the startup error. `AppSettings.DataDirectory` must be an absolute, writable path outside the service application's directory. If `QRR_CONFIG_FILE` is configured, it must name an existing absolute configuration-file path. Environment variables can override that file.

After an upgrade, verify the existing data path, Dolibarr entity and Docker volume before creating replacement entries. Keep the same Compose project identity and named volume. Avoid `docker compose down -v`, which removes volumes.

Inventory hides unassigned and consumed entries by default. Check **Type > Unassigned** and **Status > Consumed**, then clear other filters.

Upgrades from JSON-based versions through v0.3.6 import `state.json` into SQLite. After migration, `state.sqlite3` is authoritative. Deleting it to force another import can restore stale data. Follow the [update and rollback guide](updating.md), preserving coordinated backups of the service data, Dolibarr database and documents.

## Missing actions, camera problems or stale styling

- **Missing actions:** check QR read/manage permissions and the native product, stock, employee and document permissions needed for the action. History also requires **View QR operation history**. Binloc is needed only for the one-time location import. Also check that the required modules are enabled.
- **Camera unavailable:** use HTTPS, allow browser camera access, and try **Start camera** or **Restart camera**. **Manual / USB entry** remains available. The development virtual camera requires browser support for canvas streams; some browser builds, including Windows WebKit, do not provide it.
- **Old layout after an upgrade:** install matching module and service packages, reload the page and confirm that the new frontend files are deployed. Restart PHP workers if their opcode cache retains old files. Firefox fieldset borders are fixed in v0.3.7.1.

## Information to include when asking for help

Include the exact error, time and time zone, QR Router/Dolibarr/Binloc versions, deployment type, selected warehouse and entity, and the action you attempted. State whether a pending synchronization remains and whether native stock changed. Include the relevant redacted PHP/Dolibarr and service log entries. Omit API keys, session cookies and configuration secrets.
