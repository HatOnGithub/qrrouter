# QR Router 3.1

An Angular frontend embedded in Dolibarr 21.0.2, a small PHP integration gateway, and a separate .NET 10 ASP.NET Core business service. This version targets a **clean installation** with empty QR inventory and no preconfigured employees or personal warehouses. It does not require data migration or the original PHP screens.

The Angular code follows DeltaNext's engineering conventions: Angular/Material 21.1.5, standalone components, signals, `inject()`, lazy routes, typed HTTP services and a shared module. Its visual layout is specific to Dolibarr: inherited typography/colors, compact sections and horizontal module navigation, without DeltaNext branding, dark sidebar or gradient cards. Material controls and overlays take their colors/fonts from the host's native controls; the module does not change document-level theme variables. C# follows DeltaNext's controller/service/repository/options/middleware organization. The supplied original module remains under `reference/module-2.6.14` as reference and test-fixture material; its documentation describes the old implementation.

```mermaid
flowchart LR
    Angular[Angular browser app] -->|Dolibarr session + CSRF| PHP[PHP gateway]
    PHP -->|Server API key| API[ASP.NET Core business service]
    API --> Store[Per-entity persistent state]
    PHP -->|Native APIs| Dolibarr[Dolibarr stock and warehouses]
    PHP -->|Read only| Binloc[Binloc locations]
```

Angular owns inventory views, scanner/manual input, registration/editing, workflows, labels, bin summaries, picking and personal warehouse settings. PHP owns the authenticated shell, session/permission/CSRF checks, trusted native lookups, stock execution, QR images and printable documents. C# owns identifiers, validation, inventory state, audit history, stock planning/staging/finalization, reconciliation, aggregation and picking allocation. The browser never receives the service API key or supplies trusted native movement evidence.

## Build the installable module

Requirements: Node.js 24, Python 3 and the .NET 10 SDK. The installed Dolibarr server needs PHP cURL, GD/TCPDF for QR image generation, and the Product, Stock and Binloc modules.

```sh
cd frontend
npm ci
cd ..
python tools/build-frontend.py
python tools/package.py
```

On Windows, use `npm.cmd` if PowerShell prevents invoking `npm.ps1`. The build copies hashed production bundles into `dolibarr/qrrouter/spa` and produces `artifacts/module_qrrouter-3.1.0.zip`. Dependencies, Angular caches, compiled bundles and test output are excluded from Git; `frontend/package-lock.json` is tracked. Always rebuild before packaging a source checkout. Production PHP requires neither Node nor an Angular development server.

The UI opens at `/custom/qrrouter/index.php`. Angular uses hash routes such as `#/inventory` and `#/items/23456X`, so Apache/Nginx rewrite rules are unnecessary. The installed module has one Dolibarr top-level menu entry; Angular provides its internal navigation. The package contains the app and native print/media endpoints, not the original PHP screen implementation.

Frontend changes must be rebuilt and deployed with the complete module directory, including `spa/`. Rebuilding the C# service alone does not deploy Angular or PHP changes. After copying an updated module, reload the page; restart PHP workers if opcode caching is configured to retain old PHP files.

## Docker deployment

1. Copy `.env.example` to `.env`. Set `QRR_SERVICE_API_KEY` to a random secret of at least 32 characters.
2. Start the business service:

   ```sh
   docker compose up -d --build --wait
   ```

3. Install `artifacts/module_qrrouter-3.1.0.zip` through Dolibarr's external-module installer, or copy the built `dolibarr/qrrouter` directory to `htdocs/custom/qrrouter`. Enable QR Router and its dependencies.
4. In Dolibarr, open **Setup → Modules/Applications → QR Router → configuration gear** (or `/custom/qrrouter/admin/setup.php`). Set:

   ```text
   Service URL: http://127.0.0.1:5087
   Service API key: <the same secret as .env>
   ```

   Save the settings. Only administrators can access this page. Settings are stored for the current Dolibarr entity through its native configuration API, including native secret encryption for the key. The saved key is never filled back into the form; leave the key field empty on later saves to keep it. No PHP/FPM environment variables are required or read for this connection. The C# container still gets its matching key from `.env` through Compose; the module cannot configure a separate service's startup environment.
5. Sign in using your normal Dolibarr administrator account. QR inventory starts empty; no sample accounts or inventory are installed. Create products, warehouses and Binloc levels in Dolibarr, then print labels and register existing stock. Registration records metadata and does not increase native stock.
6. Create active employee users in Dolibarr before using checkout. Give operators QR read/manage rights and, where needed, native stock movement rights. Personal warehouses can be mapped by an administrator or resolved/created through native Dolibarr APIs at checkout. Empty employee lists show setup guidance and disable checkout confirmation.

The default Compose configuration binds the API to host loopback, uses a persistent `qrrouter-data` volume at `/data`, runs as the non-root `app` user, drops capabilities and uses a read-only root filesystem with writable temporary storage. `/health` is a liveness endpoint; Docker invokes it through the application's `--healthcheck` mode. An empty or short API key prevents startup.

If Dolibarr runs in Docker, set `DOLIBARR_NETWORK` to its existing network and use:

```sh
docker compose -f compose.yaml -f compose.dolibarr.yaml up -d --build --wait
```

In QR Router's module settings, use `http://qrrouter-api:8080` as the service URL and the same secret. The override attaches the service to that existing network; it does not deploy or modify a Dolibarr database. Use HTTPS when PHP and the service communicate across hosts. Never expose the shared service key in Angular configuration.

To build the Angular module entirely with Docker, without installing Node locally:

```sh
docker buildx build --target dolibarr-module --output type=local,dest=artifacts/docker-module .
```

If your Docker installation does not support Buildx or reports `unknown flag: --output`, export from a temporary, stopped container instead:

```sh
docker build --target dolibarr-module -t qrrouter-module:3.1.0 .
mkdir -p artifacts/docker-module
module_container=$(docker create qrrouter-module:3.1.0 /unused)
docker cp "$module_container:/qrrouter" artifacts/docker-module/
docker rm "$module_container"
```

The temporary container is never started; `/unused` only supplies the command required to create a container from the artifact image.

The output is `artifacts/docker-module/qrrouter`, ready to copy to Dolibarr's `htdocs/custom`. The default Docker target remains the C# runtime; frontend dependencies are not included in the API runtime image. Docker image execution still needs verification on a machine with a running Docker daemon.

Use one service instance with a local persistent volume. File locks and atomic rename protect local writers; the store is not intended for distributed replicas/network filesystems. Back up the service volume, Dolibarr database, and QR thumbnail directory. `docker compose down` retains the volume; `down -v` removes it. No production database or user accounts are changed by the build or tests.

## Development and validation

```sh
dotnet build QrRouter.sln -c Release
dotnet run --project tests/QrRouterApi.Tests -c Release
python tests/http_smoke.py
python tests/angular_integration.py --php /path/to/php
```

For browser checks, install Playwright Chromium once, then run the complete gateway/browser fixture:

```sh
cd frontend
npx playwright install chromium
cd ..
python tests/angular_integration.py --php /path/to/php --browser
```

The C# console runner has no test-framework dependency; use `dotnet run`, not `dotnet test`. It covers identifiers, entity/permission isolation, quantities, concurrent state writes, optimistic revisions, native evidence, corruption handling and recovery. The HTTP smoke test starts the real ASP.NET host and restarts it with a pending operation. Gateway tests run the deployed PHP code against the real C# service and native Dolibarr-shaped mocks; browser checks run the built Angular app inside that PHP shell. They cover registration, native moves, picking, scanner validation, camera denial/cleanup, mobile navigation, fresh-install empty states, and inheritance from light/dark host themes. These are not tests against a live Dolibarr database or physical camera.

On Windows without PHP:

```sh
python tools/test-php-runtime.py
python tests/angular_integration.py --php artifacts/php-runtime/php.exe --extension-dir artifacts/php-runtime/ext --browser
```

The helper downloads portable PHP 8.3 into ignored `artifacts`, checks the official SHA-256, and changes no system configuration. `tests/php_integration.py` remains an alias for the current integration suite.

For frontend work, `npm start` runs Angular with a proxy to a PHP/Dolibarr host at `127.0.0.1:8088`; adjust `frontend/proxy.conf.json` to your development installation. Requests still need an authenticated Dolibarr session. Alternatively rebuild into `spa` and serve through Dolibarr to exercise the real host path. To run C# without Docker, set `AppSettings__ApiKey`, an absolute writable `AppSettings__DataDirectory`, and `ASPNETCORE_URLS=http://127.0.0.1:5087`, then run `dotnet run --project src/QrRouterApi`.

## Source formatting

Angular files use two-space indentation, single-quoted TypeScript strings, expanded templates and separate HTML/CSS files. PHP and C# use four-space indentation. `.editorconfig`, Prettier and the repository-local CSharpier tool keep this consistent without changing the Dolibarr visual theme. Reference files and generated output are excluded.

```sh
cd frontend
npm run format
npm run format:check
cd ..
dotnet tool restore
dotnet csharpier format src tests/QrRouterApi.Tests
dotnet csharpier check src tests/QrRouterApi.Tests
```

## Integration boundary

Angular calls `api.php` on the same origin. GET resources supply bootstrap data, products, warehouse levels, references, orders, bin summaries and picking. POST actions are explicitly allowed: metadata create/update/bulk/register, count establishment, box-content transfer, native workflows, reconciliation, mappings and local label settings. Mutations carry the native Dolibarr form token and a session-bound QR CSRF token. There is no arbitrary service-command proxy. PHP rebuilds native facts from Dolibarr and ignores browser-supplied service headers, warehouses, effects and patches.

Stock mutations follow a recoverable sequence:

1. C# plans against authoritative state and returns its revision.
2. PHP checks physical product, warehouse, native quantity and lot/serial facts.
3. C# verifies the revision and durably stages a unique operation.
4. PHP executes the native Dolibarr stock transaction using that inventory code.
5. C# finalizes only after PHP supplies evidence of exactly the expected native movements.

Failures retain pending operations for investigation/reconciliation. Full evidence completes an operation, zero evidence can cancel an old operation, and partial/conflicting evidence blocks automatic changes. Confirm that the original request has ended before reconciling; the 30-second minimum alone does not prove it has stopped. Do not automatically retry timed-out stock mutations. Same-warehouse bin changes and explicitly already-posted consumption/returns can update QR metadata without posting native stock again.

The API key authenticates the trusted PHP adapter. Its entity, user and permission headers are assertions from the Dolibarr session, not independent browser credentials. The C# service has no direct Dolibarr database connection. The `/api/inventory` API is private to that integration.

Dutch and French UI text comes from the existing Dolibarr translation catalog plus `langs/nl.spa.json` and `langs/fr.spa.json`; missing translations fall back to English. The QR decoder is bundled locally, with no camera-decoder CDN dependency. Camera access needs a secure browser context and user permission.
