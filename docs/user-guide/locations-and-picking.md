# Locations and picking

[Guide index](README.md)

## Browse bins and locations

1. Open **Bins and locations**.
2. Choose a **Warehouse**, then a **Bin**. Choose **No bin assigned** to inspect items without a location.
3. Review tracked items and product totals for generic units, container units and unknown containers.
4. Select an item or native product link for more detail.
5. Use **Print bin inventory** to open a printable contents list.

**Warehouse stock comparison** shows QR observations alongside native stock. Viewing or printing this page does not adjust stock. Investigate differences before using a stock-changing workflow.

Binloc's native bin labels remain separate from QR item labels. No QR code or bin scan is required; use the warehouse and location fields to choose where an item belongs.

## Adjust the local location display

1. Choose the warehouse on **Bins and locations**.
2. If **Binloc local label format** is available, choose which location levels to show.
3. Set the separators and **Show warehouse** option.
4. Select **Save format**.

These settings change the displayed location format only. The full stored Binloc location remains intact.

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
