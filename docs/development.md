# Development guide

[Project overview](../README.md) ? [Installation guide](installation.md) ? [User guide](user-guide/README.md)

## Local requirements

Use Python 3, the .NET 10 SDK and a supported Node.js version from `frontend/package.json` (Node 24.15 or newer within 24.x is supported). PHP CLI with cURL is needed for gateway integration tests. Docker is optional for image builds and deployment checks.

Install frontend dependencies from the repository root:

```sh
cd frontend
npm ci
cd ..
```

On Windows, use `npm.cmd` or `npx.cmd` when PowerShell blocks the corresponding script.

## Run the interface with mocks

```sh
cd frontend
npm run start:mock
```

Open `http://127.0.0.1:4200`. The local mock includes sample inventory and a toolbar for scenarios, language, theme, latency and resets. State is in memory and shared by browser tabs; restarting the mock or selecting **Reset and apply** resets it.

Use **Camera mock** to select an inventory label or enter QR content, then choose **Show QR code**. A virtual camera feeds the real decoder without requiring a physical device. **Clear frame**, rotation, size and failure modes help exercise capture behavior. Real camera access is an explicit option.

Use `npm run start:mock -- --port 4300` for another frontend port. Set `QRR_MOCK_PORT` if the default mock API port 8089 is occupied. Ctrl+C stops both servers. Restart after changing mock API code or fixtures. Mock tools are excluded from production builds.

## Persistent service configuration

The service persists each entity in `state.sqlite3` through Entity Framework Core with SQLite transactions. Item/settings records and append-only audit history are stored separately; warehouse queries use an index. Full state exports remain schema-2 JSON. The private inventory endpoint omits audit history by default; `?includeHistory=true` includes it for exports. Existing `state.json` files are imported once and retained unchanged.

Real service runs require an absolute `AppSettings.DataDirectory` outside the service application's directory. Set it and the API key through environment variables, or point `QRR_CONFIG_FILE` to an external JSON settings file. A configured file must exist. See the [update guide](updating.md) for storage layout and migration from earlier application-local data.

The frontend mock remains temporary, in-memory sample data for development; it does not replace persistent service storage.

## Responsibility boundaries

- `frontend/src/app/features`: interface pages and workflow interaction. Keep styles with the component that owns them.
- `frontend/src/app/shared`: reusable controls, capture and location input.
- `frontend/src/app/core`: browser models and services.
- `dolibarr/qrrouter/api.php`: authenticated gateway routing and orchestration.
- `dolibarr/qrrouter/lib`: trusted request preparation, native Dolibarr/Binloc integration, authorization, metadata and printing helpers.
- `src/QrRouterApi`: QR identities, inventory state, business validation, planning and durable operation handling.
- `frontend/dev` and `tests`: development mocks and integration fixtures.

Keep stock and native identity authority in the server integration. Browser requests do not supply trusted movement evidence or service keys. Product search metadata is a read-only projection that must respect native visibility and permissions.

## Build the installable module

From the repository root:

```sh
python tools/build-frontend.py
python tools/package.py
```

The first command builds Angular and copies its production output into `dolibarr/qrrouter/spa`. Packaging validates the project versions and creates `artifacts/module_qrrouter-v0.3.6.zip`. Rebuild before packaging frontend changes; a service build alone does not deploy PHP or frontend changes.

Build the service separately:

```sh
dotnet build QrRouter.sln -c Release
```

To export a built module directory using Docker:

```sh
docker buildx build --target dolibarr-module --output type=local,dest=artifacts/docker-module .
```

The result is `artifacts/docker-module/qrrouter`. For installation from published assets, see [Installation](installation.md).

## Validate changes

### Service and gateway

```sh
dotnet run --project tests/QrRouterApi.Tests -c Release
python tests/http_smoke.py
python tests/angular_integration.py --php /path/to/php
```

The service assertions run through a console runner, so use `dotnet run`. The gateway suite executes the PHP module against the real service and Dolibarr-shaped fixtures, including authorization, stock transactions and recovery.

### Database migrations

The EF model lives in `src/QrRouterApi/Repositories/InventoryDbContext.cs`; versioned migrations and the model snapshot live in `src/QrRouterApi/Migrations`. Change the model, then scaffold a migration from the repository root:

```sh
dotnet tool restore
dotnet tool run dotnet-ef migrations add DescribeTheChange --project src/QrRouterApi
dotnet tool run dotnet-ef migrations has-pending-model-changes --project src/QrRouterApi
dotnet run --project tests/QrRouterApi.Tests -c Release
```

Review generated `Up` and `Down` methods and add a data-preservation test for any data conversion. Commit the migration, designer and snapshot together. The design-time factory uses an in-memory connection so scaffolding cannot touch live inventory. `database update` requires an explicit `--connection` to affect a persistent database; use a test copy for manual verification.

On first access to each entity after deployment, the repository applies pending migrations, then transactionally imports legacy JSON if that entity has not been initialized. It rejects database migration histories from newer service versions. Back up with the service stopped before updates; do not use `EnsureCreated` or remove applied migrations. The service runner checks the model against its snapshot as well as migration, concurrent-write, rollback and recovery behavior. See [EF Core migration guidance](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/) for tooling details.

### Browser integration

Install Chromium once:

```sh
cd frontend
npx playwright install chromium
cd ..
```

Build the production frontend, then run:

```sh
python tests/angular_integration.py --php /path/to/php --browser
```

On Windows, a portable PHP runtime can be prepared without changing system configuration:

```sh
python tools/test-php-runtime.py
python tests/angular_integration.py --php artifacts/php-runtime/php.exe --extension-dir artifacts/php-runtime/ext --browser
```

### Mock API and browser checks

```sh
cd frontend
npm run test:mock
npm run typecheck:e2e:mock
npm run e2e:mock
```

The browser suite starts and stops its own mock server. Finish source edits before running it: live reload can interrupt in-progress browser workflows.

### Formatting

```sh
cd frontend
npm run format:check
```

Use `npm run format` to apply the configured frontend and PHP formatting. Keep changes focused on the files you intend to edit.

Fixtures and browser print checks do not replace a live Dolibarr/Binloc installation, physical camera, printer or Docker deployment check.
