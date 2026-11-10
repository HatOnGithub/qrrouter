# QR Router v0.3.5

QR-based inventory handling inside Dolibarr, originally developed as an internal tool for DeltaIoT.

## Features

- **Intended use:** label and identify warehouse items, locate them, track stock actions and manage employee loans from a phone or workstation.
- **Dependencies:** an existing Dolibarr installation with Product, Stock, Lot/Serial and Binloc modules, plus the QR Router business service.
- Individual items with native serial numbers, generic product labels and counted containers with native lots.
- Camera scanning and separate manual / USB scanner entry.
- Warehouse moves, consumption, returns, quantity corrections and container transfers.
- Employee checkout and checkin, location summaries and picking previews.
- Individual and bulk QR label creation, including DYMO LabelWriter 550 printing.
- Inventory search by name, QR ID, serial, product reference, tags and visible extra fields.
- Links between QR entries and related Dolibarr records.

## Installation

Download the module ZIP and matching business service ZIP from [Releases](https://github.com/HatOnGithub/qrrouter/releases). Install the module through Dolibarr's external-module installer, then start and connect the service as described in the [installation guide](docs/installation.md).

## Usage

1. Sign in to Dolibarr and open **QR Router**.
2. Create labels through **Print QR labels** or **Inventory > Create QR item**.
3. Open **Scan QR**, choose an action and select your items.
4. Review the details and confirm.

See the [user guide](docs/user-guide/README.md) for every interface area and step-by-step scanner workflows. Available actions depend on your Dolibarr permissions.

## Development

See the [development guide](docs/development.md) for local setup, mocks, builds and tests.
