# Update guide

[Project overview](../README.md) | [Installation](installation.md) | [User guide](user-guide/README.md)

Updates replace application files. Inventory, configuration and native stock must remain in their existing persistent stores. Use matching module and service files from the same release.

## What to preserve

| Store                               | Contents                                                                                                                                                                               | Keep across updates                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Service `AppSettings.DataDirectory` | Per-entity `entity-N/state.sqlite3` databases (older releases: `state.json`): QR identities, associations, batches, employee warehouse mappings, loans, history and pending operations | The complete data directory, outside the service application directory                              |
| External service settings           | API key and absolute data directory, with any other service settings                                                                                                                   | An external JSON file referenced by `QRR_CONFIG_FILE`, or the existing service environment settings |
| Dolibarr database                   | Products, serials/lots, stock, Binloc locations, permissions, module settings and native synchronization receipts                                                                      | The existing database, including QR Router tables and settings                                      |
| Dolibarr documents                  | QR scan thumbnails under `DOL_DATA_ROOT/qrrouter/entity-N/thumbnails`                                                                                                                  | The existing Dolibarr documents directory                                                           |

Do not rebuild QR associations by registering or importing the same inventory again. Reuse the saved service state. Current state files use schema 2; invalid or unsupported state is rejected rather than reset automatically.

## 1. Prepare and back up

1. Download the module and business service ZIPs for the chosen release from [Releases](https://github.com/HatOnGithub/qrrouter/releases). Check its notes for any required migration.
2. Record the current service URL, service account, configuration path, actual data path and Dolibarr entity IDs. Keep the previous application files for rollback.
3. Ask operators to stop using QR Router. Let active requests finish and resolve pending synchronization or stock operations where possible.
4. Stop the business service and keep QR Router unavailable during the update.
5. Back up the complete service data directory, external service settings, Dolibarr database and QR document directory together. Verify that each used entity has its expected `state.sqlite3` (or pre-migration `state.json`) in the backup. Copy the whole entity directory, including any SQLite `-wal` and `-shm` files; never copy only the database while the service is running.

## 2. Move application-local data once, if necessary

If your existing service already uses an absolute data path outside its application directory, keep that path and skip the move.

Earlier installations could use `DataDirectory: "data"`. This was resolved relative to the service's **working directory**, which might differ from the folder containing its DLL. Locate the actual existing `entity-N/state.sqlite3` or older `state.json` files before proceeding. Do not point the update at a new empty folder and assume the old inventory will be found automatically.

1. With the service stopped, copy the **entire existing data directory** to a persistent location outside the application directory, such as `/var/lib/qrrouter` on Linux or `C:/ProgramData/QrRouter/data` on Windows.
2. Check that the copied entity directories match the originals for every entity. Keep the original directory and backup until verification is complete.
3. Give the service account read/write access to the new data directory.
4. Set `AppSettings.DataDirectory` to that absolute path in the settings used by the new service.

The updated service requires an absolute data path outside its application directory. Empty, relative and application-local paths prevent startup. It does not automatically move or discard existing data.

### Database migrations and JSON import

When upgrading from a JSON-based release (through v0.3.6), stop the old service before starting the new one. On first access to each entity, Entity Framework Core applies pending versioned schema migrations. The service then validates its existing `state.json` and imports the entire inventory, history and pending operations into `state.sqlite3` in one transaction. Invalid JSON is rejected; it is never replaced with empty inventory. No Dolibarr stock movements are created by migration.

The original JSON remains unchanged as a migration backup. After migration, SQLite is authoritative and the JSON is no longer updated. Do not run an older JSON-based service against the same directory, edit the old JSON expecting changes to appear, or delete the database to force another import. To roll back, restore the coordinated pre-update backups described below. Keep the existing absolute `DataDirectory` and Docker volume.

SQLite uses local disk storage and write-ahead logging. Use the stopped-service backup procedure above, preserving all files together. Network shares and multiple distributed service replicas are not supported.

## 3. Keep settings outside the release directory

For a standalone service, create a persistent JSON settings file outside the application directory, for example `/etc/qrrouter/service.json` or `C:/ProgramData/QrRouter/service.json`:

```json
{
  "AppSettings": {
    "ApiKey": "KEEP-YOUR-EXISTING-SERVICE-KEY-HERE",
    "DataDirectory": "/var/lib/qrrouter"
  }
}
```

Use your existing key and actual data path, not these placeholder values. On Windows, a path such as `C:/ProgramData/QrRouter/data` works in JSON without escaping backslashes. Limit access to the settings file to the administrator and service account.

Set the absolute configuration file path in the service manager's environment:

```sh
# Linux/macOS shell example; persist this in the service manager as well.
export QRR_CONFIG_FILE=/etc/qrrouter/service.json
```

```powershell
# Windows PowerShell example; persist this in the service manager as well.
$env:QRR_CONFIG_FILE = 'C:/ProgramData/QrRouter/service.json'
```

The file must exist; a missing or invalid file prevents startup. Existing `AppSettings__ApiKey` and `AppSettings__DataDirectory` environment variables remain supported and override the JSON file, as do command-line settings. Check them for old paths before restarting. Docker Compose already supplies these settings through its environment and does not need an external JSON file.

## 4. Replace and restart

1. Extract the new service ZIP into a new application directory. Keep the persistent settings and data directories separate; do not replace them with release defaults.
2. Update the service manager to launch the new `QrRouterApi.dll`, retaining the configuration file environment variable, account and listener URL.
3. Install the matching module ZIP through Dolibarr's external-module installer, or replace only `htdocs/custom/qrrouter` with the new module files. Keep the Dolibarr documents directory and database.
4. If the release changes module tables, tabs, hooks or menus, disable and re-enable QR Router in Dolibarr's module setup. Do not uninstall its database data or delete module settings.
5. Start the service. Check `/health`, then open QR Router and select **Refresh**. Confirm that the saved module service URL and key still match.
6. Reload the browser. Restart PHP workers if their opcode cache retains old files.

Changing the application's directory or the service's working directory must not change the configured data directory.

### Docker Compose deployments

The supplied Compose file stores service data at `/data` in a named volume. Replacing the container preserves that volume.

1. Record the existing Compose project name and the volume mounted at `/data`; back up that volume with the service stopped.
2. Update the source checkout to the desired release and install its matching Dolibarr module.
3. Keep the same `.env`, Compose project name, networks and named volume. If changing the checkout's directory, pass the original project name using `docker compose -p ORIGINAL_PROJECT ...`.
4. Start the updated container using the same Compose files as before:

   ```sh
   docker compose up -d --build --wait qrrouter-api
   ```

5. Verify the existing data and stock as below.

Do not run `docker compose down -v`, delete the named volume or change its identity during an update. Keep any existing Dolibarr-network override when starting the new container.

## 5. Verify before reopening access

- Check representative old QR IDs, serial/lot links, batches, locations, quantities and employee loans for each entity.
- Confirm that existing printed labels still open their original entries.
- Compare native stock in Dolibarr; an update itself should not create stock movements.
- Remember that Inventory hides unassigned and consumed items by default. Use **Type > Unassigned** or **Status > Consumed** before concluding that records are missing.
- Resolve any pending operation through its recovery controls instead of repeating the original stock action.

If inventory is unexpectedly empty, stop the service and check the configured path, environment overrides, entity and Docker volume first. Do not create replacement records or import a backup into the empty-looking service until the storage mismatch is understood.

## Roll back if needed

1. Stop access and the service again.
2. Restore the previous matching module and service application files and their settings.
3. If the update migrated data or operators changed stock afterward, restore the **matching backed-up service state, Dolibarr database and documents together**. Restoring only one side can leave QR associations or quantities inconsistent. Account for any physical stock changes before resuming.
4. Start the previous service and repeat the verification steps.

Keep backups independently of the application directory and Docker container. Persistence across updates does not replace backups against disk failure or accidental deletion.
