# Code documentation

This folder documents the implementation in this checkout, including permissions, operation history, physical bins, pick lists and pending synchronization details. Start here when changing the code; use the [user guide](../user-guide/README.md) for interface instructions and the [development guide](../development.md) for setup commands.

## Reading order

1. [Architecture and request flow](architecture.md): responsibilities, authority and trust boundaries.
2. [State and persistence](state-and-persistence.md): item types, durable intents, SQLite records and migrations.
3. [Permissions and public projections](permissions.md): independent grants, native visibility and information filtering.
4. [Synchronization and recovery](synchronization.md): staging, native receipts, movement evidence and failure handling.
5. [Gateway and service contracts](api-contracts.md): browser resources, internal commands, identity headers and errors.
6. [Domain features](domain-features.md): creation, locations, physical bins, picking and history.
7. [Frontend and printing](frontend.md): state, scanning, CSV import, reusable components and print rendering.
8. [Source map](source-map.md): where to find the implementation of each responsibility.
9. [Testing and maintenance](testing-and-maintenance.md): validation, extending workflows, migrations and releases.
10. [Barcodes and layouts](barcodes.md): carrier-independent IDs, native rendering, decoding and 1D/2D label placement.

## Find a change by task

| Task                               | Start with                                                 | Related implementation                                                 |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Add or change an action grant      | [Permissions](permissions.md)                              | PHP security helpers, C# capability mapping, Angular `can()`           |
| Change a stock workflow            | [Synchronization](synchronization.md)                      | `InventoryService.Plan/Stage/Finish`, PHP workflow or checkout adapter |
| Diagnose an uncertain stock result | [Recovery failure cases](synchronization.md#failure-cases) | Native receipts, movement evidence, retained intent                    |
| Add a state collection             | [Persistence](state-and-persistence.md)                    | Repository `Maps`, `Load`, `Save`, validation and migration tests      |
| Change scanner payloads            | [Frontend](frontend.md#scanning-and-destinations)          | C# `Codes`, PHP validators, TypeScript `codes.ts`                      |
| Extend pending details or history  | [Public projections](permissions.md#public-projections)    | Explicit field selection; never return raw internal state              |
| Change a label                     | [Printing](frontend.md#printing)                           | PHP authorized data preparation and standalone TypeScript renderer     |
| Add a new page                     | [Frontend](frontend.md)                                    | Lazy route, feature component, shared controls and gateway resources   |

The code comments explain local contracts and non-obvious constraints. Keep those comments and these documents aligned when changing behavior. Generated migrations and build output should be regenerated through their tools rather than used as the primary explanation of the system.
