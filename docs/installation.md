# Installation guide

[Project overview](../README.md) ? [User guide](user-guide/README.md) ? [Development guide](development.md)

## Requirements

- An existing Dolibarr installation. The integration targets Dolibarr 21.0.2 and Binloc 2.19.1.
- Product, Stock, Lot/Serial and Binloc modules enabled.
- PHP cURL and GD, with Dolibarr's QR/TCPDF support available.
- The .NET 10 ASP.NET Core Runtime on the machine that will run the QR Router business service. A .NET SDK and Node.js are not needed to install release files.
- An internal Dolibarr administrator account for installation and setup.
- HTTPS access to Dolibarr for camera scanning from phones and remote workstations. Manual / USB entry remains available without camera access.

For a new installation, follow the steps below. For an existing installation, follow the [update guide](updating.md) to preserve its data. Install the module and business service from the same release.

## 1. Download a release

1. Open the project's [Releases](https://github.com/HatOnGithub/qrrouter/releases) page and choose a release.
2. Under **Assets**, download both files for the same version:
   - `module_qrrouter-v0.3.8.zip`: the installable Dolibarr module, including its built interface.
   - `qrrouter-service-v0.3.8.zip`: the matching portable business service.
3. Download `SHA256SUMS` if you want to verify the files against their published SHA-256 checksums.

The filenames above illustrate v0.3.8; use the matching files from your chosen release. Download the attached module ZIP rather than GitHub's automatically generated **Source code** archive, which does not include the built interface. If no release is available yet, use the [source build instructions](development.md#build-the-installable-module).

## 2. Start the business service

1. Extract the service ZIP into a dedicated directory on the service machine.
2. Create a JSON settings file **outside** the extracted application directory, for example `/etc/qrrouter/service.json` or `C:/ProgramData/QrRouter/service.json`. Its contents should include:

   ```json
   {
     "AppSettings": {
       "ApiKey": "REPLACE-WITH-A-RANDOM-SECRET-OF-AT-LEAST-32-CHARACTERS",
       "DataDirectory": "/var/lib/qrrouter"
     }
   }
   ```

   Replace the key and data path with your own values. The data path must be absolute, writable by the service account, and outside the application directory; for Windows, use a path such as `C:/ProgramData/QrRouter/data`. Set `QRR_CONFIG_FILE` to the absolute settings-file path in the service environment, as shown in the [update guide](updating.md#3-keep-settings-outside-the-release-directory). Keep both settings and data when installing future releases. For the earlier v0.3.5-beta.1 service, which does not yet support `QRR_CONFIG_FILE`, set these values in its `appsettings.json` and preserve that file until updating.

3. From the extracted service directory, start it:

   ```sh
   dotnet QrRouterApi.dll --urls http://127.0.0.1:5087
   ```

4. Check `http://127.0.0.1:5087/health` on that machine. A running service returns a healthy status.
5. Configure your operating system's service manager to keep the process running, using the extracted service directory as its working directory and the same arguments.

The loopback address works when Dolibarr's PHP process runs on the same machine. If Dolibarr runs in a container or on another host, configure an endpoint reachable from that PHP process; use HTTPS between hosts and restrict access to the Dolibarr server. Enter that reachable address in the module settings below.

## 3. Install and connect the Dolibarr module

1. Install the downloaded module ZIP through Dolibarr's external-module installer, or extract and copy the complete `qrrouter` directory into `htdocs/custom/qrrouter`.
2. Open **Setup > Modules/Applications**, enable QR Router and ensure its dependencies are enabled.
3. Open QR Router's configuration gear, or `/custom/qrrouter/admin/setup.php`.
4. Enter **Service URL**, using the address appropriate to the deployment above.
5. Enter **Service API key**, matching the service's `AppSettings.ApiKey`, and select **Save**.
6. Open **QR Router** and select **Refresh**. A clean installation starts with empty inventory.

The connection key is saved through Dolibarr's native configuration. Leave an already saved key blank to retain it when the URL stays the same; re-enter it when changing the URL. Do not put the key into browser or frontend configuration.

## 4. Prepare products, locations and users

1. Create the required products and warehouses in Dolibarr. Enable lot/serial tracking for products used by individual serials or containers.
2. Configure the warehouse location levels in Binloc.
3. Grant operators QR read/manage rights and the native product, stock, Binloc and document rights needed for their work. QR permissions do not replace native permissions.
4. Create active employee users before using checkout. Administrators can map their personal warehouses, or checkout can create one when permitted.
5. Open QR Router, create a test item or blank label batch, and follow the [user guide](user-guide/README.md).

Creating a new serial or container can receive stock. Linking an existing unassociated serial preserves its stock. Registering an existing box requires a matching native lot quantity. Review the chosen operation before using live inventory.

## Updates and backups

- Back up the Dolibarr database, service data directory and QR thumbnail directory together before updating.
- Install the module and service assets from the same release together. Stop the service while replacing its application files, retain its data directory and connection settings, then restart it. Disable and re-enable QR Router after module changes that add tabs, hooks, menus or tables.
- Reload the page after deployment. Restart PHP workers if their opcode cache retains old files.
- Run one service instance using a local persistent volume; the SQLite database is not intended for distributed replicas or network shares.
- Current source uses an embedded SQLite database per entity; no database server is required. JSON-based releases through v0.3.6 migrate on first access when updated.
- Keep the configured service data directory when replacing or removing application files; it contains the saved QR state.

See [Troubleshooting](troubleshooting.md) for installation errors, missing tables and service diagnostics, [Setup and help](user-guide/help.md) for recovery controls, and [the security audit](../SECURITY_AUDIT.md) for deployment limitations. Service hosting and physical printer operation require verification in your own environment.
