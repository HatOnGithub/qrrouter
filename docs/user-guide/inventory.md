# Inventory and items

[Guide index](README.md)

## Set a product's serial prefix

1. Open the product card in Dolibarr and edit its additional attributes.
2. Set **QR serial number prefix**, for example `DRILL-`, and save the product.
3. Create or register a new **Tracked Individual** in QR Router. Its serial uses that prefix followed by 24 random hexadecimal characters. Single creation, registration and bulk creation use the same setting.

Leave the prefix blank to use `SN-`. Include any desired separator in the prefix. Prefixes allow up to 76 UTF-8 bytes, without whitespace or markup; the complete serial stays within 100 bytes. Existing serials and container lot names keep their identities. If the field is missing after updating, disable and re-enable QR Router once to add it; existing prefix values are preserved.

## Find an item

1. Open **Inventory**.
2. Enter a term in **Search inventory**. Search covers QR IDs, item and product names, references, serials, lots, bins, details, product tags and extra fields you may view.
3. Optionally choose a **Warehouse**, **Type** and **Status**. These filters apply together with the search. Unassigned and consumed items are hidden by default: choose **Type > Unassigned** for blank labels, or **Status > Consumed** for consumed stock. Searching alone does not reveal these items.
4. Select an item name to open its details.

The summary shows QR labels, unassigned entries, loans and pending operations. **Loans** opens a similar list limited to loaned items.

## Read the item details

The detail page shows the product, QR ID, native serial/lot, warehouse, bin, available quantity, consumed units and any loan. Product, warehouse, lot and employee links open the corresponding Dolibarr records. Consumption history shows saved references and reasons.

Use **Print label** for an A4 label or **DYMO label sizes** for a roll label. Available item actions open the corresponding [scanner workflow](scanner.md), often with this item already selected.

## Create one assigned item

1. Open **Inventory > Create QR item**.
2. Select the **QR type**.
3. Enter the item name or box name. For **Tracked Generic**, leave the name blank to use the product short name, or enter an override.
4. Search for the **Dolibarr product** and select the exact result.
5. Choose the **Warehouse** and available QR Router location fields.
6. Complete the fields for your type:
   - **Tracked Individual:** a random Dolibarr serial is generated automatically, independently of the item name and QR ID. To link a serial already in Dolibarr, use **Register items**.
   - **Counted Container:** enter a unique **Box name / Dolibarr lot** and its **Dolibarr lot quantity**.
7. Select **Save** and check the resulting details.

Creating a new serial receives one unit. Creating a container receives its entered quantity. An existing serial can be linked if it has no QR association: inspect the availability warning first. Its existing stock is preserved. A serial already linked to another QR entry cannot be reused.

For labels you have already printed, use [Register items](scanner.md#register-items) instead. Use [assigned batches](labels.md#create-an-assigned-batch) to create several items together.

## Edit or copy an item

1. Open the item details.
2. Select **Edit metadata**, change the editable fields, then **Save**.
3. To restore a generic item's default product name, clear its name override.

Linked product, warehouse and native identity fields may be locked. Use the move workflow to relocate stock. Make native serial/lot identity changes in Dolibarr and refresh QR Router.

To start another item with similar details, select **Copy item**, review the copied fields and save. A copied item receives a separate QR ID; an individual serial is generated again using the product's current prefix.
