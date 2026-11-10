# Inventory and items

[Guide index](README.md)

## Find an item

1. Open **Inventory**.
2. Enter a term in **Search inventory**. Search covers QR IDs, item and product names, references, serials, lots, bins, details, product tags and extra fields you may view.
3. Optionally choose a **Warehouse** and **Type**. These filters apply together with the search.
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
5. Choose the **Warehouse** and available Binloc location fields.
6. Complete the fields for your type:
   - **Tracked Individual:** leave **Dolibarr serial number** blank to generate a serial from the entered context, or enter a serial. Optionally select **Use label as serial number** to use the exact item name as its serial.
   - **Counted Container:** enter a unique **Box name / Dolibarr lot** and its **Dolibarr lot quantity**.
7. Select **Save** and check the resulting details.

Creating a new serial receives one unit. Creating a container receives its entered quantity. An existing serial can be linked if it has no QR association: inspect the availability warning first. Its existing stock is preserved. A serial already linked to another QR entry cannot be reused.

For labels you have already printed, use [Register items](scanner.md#register-items) instead. Use [assigned batches](labels.md#create-an-assigned-batch) to create several items together.

## Edit or copy an item

1. Open the item details.
2. Select **Edit metadata**, change the editable fields, then **Save**.
3. To restore a generic item's default product name, clear its name override.

Linked product, warehouse and native identity fields may be locked. Use the move workflow to relocate stock. Make native serial/lot identity changes in Dolibarr and refresh QR Router.

To start another item with similar details, select **Copy item**, review the copied fields and save. A copied item receives a separate QR ID; an individual serial is generated again unless you explicitly enter one.
