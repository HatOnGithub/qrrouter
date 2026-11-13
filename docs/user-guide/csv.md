# CSV import and export

[Guide index](README.md)

## Export inventory

1. Open **Inventory** and set the search, warehouse, type and status filters.
2. Select **Export current view as CSV** to download exactly those rows.
3. For a complete inventory export, open **CSV import and export** and select **Export all accessible inventory**. This includes unassigned and consumed entries you may view.

Exports use UTF-8 with a BOM for spreadsheet compatibility. Commas, quotes and multiline details are quoted. Values that could be interpreted as spreadsheet formulas receive a protective apostrophe; QR Router removes that protection when reading its CSV again. Exported fields respect your Dolibarr permissions. Keep database backups for audit history, loans, settings and pending-operation recovery.

## Create or register items

1. Open **Inventory > CSV import and export** and select **Download CSV template**.
2. Add one item per row. Keep the header names. Save as UTF-8 CSV using commas or semicolons. Import up to **200 rows**, with a maximum file size of **1 MiB**.
3. Leave `code` blank to create a new QR ID. To assign an existing blank QR, enter its current QR ID. Unknown QR IDs are rejected; they are not silently recreated.
4. Set `type` to `generic`, `tracked`, `box` or `unassigned`. For assigned types, enter the exact Dolibarr `product_ref` and `warehouse_ref`.
5. For a tracked individual, leave `serial` and `lot` blank to generate a new serial using the product's prefix. To link an existing native serial, enter it in `serial`; it must exist in Dolibarr and have no QR association.
6. For a container, set `label` to its unique box/lot name and `quantity` to its known quantity. New serials and containers can receive native stock through the normal Dolibarr rules. Generic and individual QR entries represent one unit each.
7. Select the **CSV file**, inspect the proposed action and message for every row, and correct all invalid rows before continuing. Previewing does not create items or stock movements.
8. Select **Confirm CSV import**, keep the page open and review the results.
9. Select **Download import results** to retain the new QR IDs, generated serials and per-row outcomes.

Import requires QR manage rights and the native permissions for each operation. Existing stock, serial and lot checks still apply when the import is executed.

## Update existing entries

1. Export the relevant inventory rows.
2. Keep each `code` and edit the permitted fields, such as `label`, tracked-item `details` or location values.
3. Upload the CSV, review the preview and confirm. Unchanged rows are skipped.

Assigned entries keep their type, product, warehouse, quantity, serial and lot identity. Use the warehouse workflows for stock changes, transfers, returns and consumption. Container labels are native lot names and cannot be renamed through CSV. Return checked-out items or reconcile pending operations before updating them. Unchanged consumed or loaned rows can remain in an exported file without causing stock actions.

Omitted columns preserve existing values. Empty label/details cells clear those fields; an empty generic label restores the product's display name. Empty location cells preserve the current location. To clear a location, set `location_values` to `{}` and clear `location`.

## Columns

| Column | Meaning |
| --- | --- |
| `code` | Existing QR ID for update/registration; blank creates a new ID. |
| `type` | Required header; values are `generic`, `tracked`, `box` or `unassigned`. An empty cell preserves an existing entry's type. |
| `label` | QR name override, individual name or container lot name. |
| `product_ref`, `product_id` | Dolibarr product reference; optional ID disambiguates shared references. For a new product absent from the current inventory, provide its reference. |
| `product_name` | Informational product display name; does not change the product. |
| `warehouse_ref`, `warehouse_id` | Accessible warehouse reference, optionally disambiguated by ID. |
| `quantity` | Known container quantity; one for new individuals/generics. Existing quantities are read-only. |
| `serial` | Existing native serial to link, or blank for automatic generation of new individuals. Existing identities are read-only. |
| `lot` | Native identity on export; if supplied for an individual it must match `serial`, or for a container it must match `label`. |
| `location` | Location text for a warehouse with one level. |
| `location_values` | JSON object for structured locations, using existing level IDs and option IDs. Preserve the exported keys when editing; for example `{"1":101,"2":"3"}`. |
| `status` | Informational, read-only stock status. |
| `details` | Individual-item notes. |
| `import_status`, `import_message` | Informational results; ignored when reading a results file again. |

Product and warehouse references must match the accessible Dolibarr records. A structured location's option IDs belong to its warehouse configuration; adjust them before importing into another warehouse or entity.

## Resolve an interrupted import

Rows are committed separately. The first server error stops the import, preserving completed rows and leaving later rows unattempted. Download the results before leaving the page. Resolve any pending native operation and inspect the inventory before retrying a failed request, especially after a connection loss.

The results CSV includes QR IDs and current native identities for completed rows. Re-upload that file after fixing the failed rows: completed, unchanged entries are skipped instead of created again. If another operator changed inventory after preview, select **Refresh preview** before confirming.
