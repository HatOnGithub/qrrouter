# Installation guide

[Project overview](../README.md) ? [User guide](user-guide/README.md) ? [Development guide](development.md)

## Requirements

- An existing Dolibarr installation. The integration targets Dolibarr 21.0.2 and Binloc 2.19.1.
- Product, Stock, Lot/Serial and Binloc modules enabled.
- PHP cURL and GD, with Dolibarr's QR/TCPDF support available.
- A running QR Router business service. Docker Compose is the deployment method described below.
- An internal Dolibarr administrator account for installation and setup.
- HTTPS access to Dolibarr for camera scanning from phones and remote workstations. Manual / USB entry remains available without camera access.

This development version targets a clean QR Router installation. Deploy the PHP module, built frontend and service together.

## 1. Prepare the module

There is no published release yet. Build the installable module from this checkout using the [build instructions](development.md#build-the-installable-module), or export it with Docker:

```sh
docker buildx build --target dolibarr-module --output type=local,dest=artifacts/docker-module .
```

The Docker export produces `artifacts/docker-module/qrrouter`, ready to copy into Dolibarr's `htdocs/custom` directory. The source build produces `artifacts/module_qrrouter-v0.3.5.zip` for Dolibarr's external-module installer. Both must include the built `spa` directory.

## 2. Start the business service

1. Copy `.env.example` to `.env` in the repository root.
2. Set `QRR_SERVICE_API_KEY` to a random secret of at least 32 characters. Keep it for the Dolibarr connection step.
3. Start the service:

   ```sh
   docker compose up -d --build --wait
   ```

The default configuration exposes the service on the Docker host at `http://127.0.0.1:5087` and stores QR state in the persistent `qrrouter-data` volume. This address works when Dolibarr's PHP process runs on that same host.

### If Dolibarr runs in Docker

Set `DOLIBARR_NETWORK` in `.env` to the existing network used by Dolibarr, then start with:

```sh
docker compose -f compose.yaml -f compose.dolibarr.yaml up -d --build --wait
```

Use `http://qrrouter-api:8080` in the module settings. This joins the existing network; it does not install Dolibarr or its database. For a service on another host, configure a reachable HTTPS endpoint and restrict access to the Dolibarr server.

## 3. Install and connect the Dolibarr module

1. Install the built ZIP through Dolibarr's external-module installer, or copy the complete built `qrrouter` directory into `htdocs/custom/qrrouter`.
2. Open **Setup > Modules/Applications**, enable QR Router and ensure its dependencies are enabled.
3. Open QR Router's configuration gear, or `/custom/qrrouter/admin/setup.php`.
4. Enter **Service URL**, using the address appropriate to the deployment above.
5. Enter **Service API key**, matching `.env`, and select **Save**.
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

- Back up the Dolibarr database, service data volume and QR thumbnail directory together before updating.
- Deploy the rebuilt frontend, PHP module and service together. Disable and re-enable QR Router after module changes that add tabs, hooks, menus or tables.
- Reload the page after deployment. Restart PHP workers if their opcode cache retains old files.
- Run one service instance using a local persistent volume; the file store is not intended for distributed replicas.
- Keep the service volume when stopping containers. Removing Docker volumes removes the saved QR state.

See [Setup and help](user-guide/help.md) for connection and synchronization problems, and [the security audit](../SECURITY_AUDIT.md) for deployment limitations. Docker deployment and physical printer operation require verification in your own environment.
