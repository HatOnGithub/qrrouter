# Locations and picking

[Guide index](README.md)

## Browse bins and locations

1. Open **Bins and locations**.
2. Choose a **Warehouse**, then a **Bin**. Choose **No bin assigned** to inspect items without a location.
3. Review tracked items and product totals for generic units, container units and unknown containers.
4. Select an item or native product link for more detail.
5. Use **Print bin inventory** to open a printable contents list.

**Warehouse stock comparison** shows QR observations alongside native stock. Viewing or printing this page does not adjust stock. Investigate differences before using a stock-changing workflow.

Location printouts remain separate from QR item labels. No QR code or bin scan is required; use the warehouse and location fields to choose where an item belongs.

## Adjust the local location display

1. Choose the warehouse on **Bins and locations**.
2. If **Location label format** is available, choose which location levels to show.
3. Set the separators and **Show warehouse** option.
4. Select **Save format**.

These settings change the displayed location format only. The full stored QR Router location remains intact.

## Generate a picking sheet

1. Open **Picking**.
2. Search **Customer order** and select the exact order.
3. Choose the **Warehouse**.
4. Select **Generate preview**.
5. Review the proposed bins, products, QR entries and quantities. Item and product links open their details.
6. Select **Print / Save as PDF** to take the sheet to the warehouse.

The sheet is a planning preview. It uses requested order quantities, not the remaining unshipped balance, and does not reserve, consume or decrement stock. Record the actual stock action separately using the appropriate workflow.

## Open QR entries from Dolibarr

1. Open a product, warehouse or lot/serial card in Dolibarr.
2. Select its **QR entries** tab or action to view related QR items. The warehouse menu also provides **QR entries** near the location actions.
3. Select a QR entry to open its detail page.

Employee cards link to current QR loans. Customer orders, manufacturing orders and shipment cards link to QR entries with saved transaction references. Related lists respect your native Dolibarr permissions.

## Configure internal locations

1. Open **Bins and locations** and choose the warehouse.
2. Under **Location levels**, enter one level name per line, such as Aisle, Rack and Shelf. Save before assigning items. A new warehouse starts with a single free-text **Location** field.
3. You can append levels later. Levels already in use cannot be removed. For imported lists, use **Add location options** to add values without changing existing option identities.
4. To assign or change a location, select **Change location** beside an item, edit its location values and save. To move stock to another warehouse, use the scanner's **Move** action instead.
5. Native warehouse cards have a **Locations** link and tab. Product and serial/lot cards link to their QR entries, where **Change location** opens the same editor. The native serial list also links directly to associated QR items.

Definitions and assignments are saved in QR Router's service database. Dolibarr owns warehouse stock, quantities and serial/lot identities. A native stock move to a different warehouse clears the old QR location; assign a location in the new warehouse.

## Import existing locations once

With an administrator account and the old location module still available, select **Import Binloc locations** before configuring those warehouses in QR Router. The import copies definitions and assignments for QR-associated lots, preserving warehouses already configured in QR Router. It rejects mismatched stock warehouses or an import with no new warehouses, and rolls back on failure. Verify the result before disabling Binloc. Future location edits are internal and are not written back to Binloc.
