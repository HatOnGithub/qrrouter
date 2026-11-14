# Locations and picking

[Guide index](README.md)

## Browse bins and locations

1. Open **Bins and locations**.
2. Choose a **Warehouse**. **All bins** shows its full QR-managed inventory, including items without a location. Type in **Search bins** to narrow the bin choices, then choose a **Bin** to filter its contents. Select **All bins** again to clear the bin filter.
3. Review tracked items and product totals for generic units, container units and unknown containers.
4. Select an item or native product link for more detail.
5. Use **Print bin inventory** or **Print warehouse inventory** to print the selected scope.

**Warehouse stock comparison** shows QR observations alongside native stock. Viewing or printing this page does not adjust stock. Investigate differences before using a stock-changing workflow.

Location labels remain separate from QR item labels. Select **Print bin labels** for location QR labels, or **Print bin inventory** for a contents report with the selected location's QR. Scan a location label to open current contents, then select **Refresh contents** to reload them. During a move, **Scan destination bin** selects the location and shows its current contents. The same location-level definitions and validation apply to manual entry and scanned destinations.

## Pack and move physical bins

1. Open **Physical bins**, name a new bin and select its current warehouse and location levels.
2. Select **Create physical bin**, then print its permanent QR label.
3. Select **Pack or unpack items**, scan item labels and select **Pack selected items**. Items must already be at the bin's current location. Packing changes membership without changing stock.
4. Select **Scan destination bin** or fill in the destination warehouse and location levels. Review the destination contents and select **Confirm bin move**.
5. Each packed item moves through its normal native stock operation. Interrupted moves retain their original destination and lock packed items against conflicting work. Reconcile pending item operations, then select **Resume bin move**; completed items are skipped.

The bin retains its permanent QR identity when it moves. Scanning its QR opens current contents; scanning it in the Move workflow opens the bin's move page. Moving an item separately, changing its location, checking it out or fully consuming it removes its membership. Location definitions used by a physical bin remain protected even when the bin is empty.

## Report by location level

1. Choose a **Warehouse** on **Bins and locations**.
2. Under **Report by level**, select a configured level, such as Aisle, Rack or Shelf.
3. Choose a **Level value**. For example, selecting Aisle A includes items on every shelf and bin in that aisle. Selecting Shelf 2 includes that shelf value across the warehouse.
4. Review the tracked items and product totals, then select **Print location report** for the same selection.
5. Choose **All values** to see the full warehouse again, or **Exact bin / whole warehouse** to return to the searchable bin selector.

Reports match saved level identities and values, independently of label formatting. Items with no value for the selected level are excluded from that level's report. Viewing and printing reports requires read access; location management permission is not needed. The stock comparison remains warehouse-wide.

## Adjust the local location display

1. Choose the warehouse on **Bins and locations**.
2. If **Location label format** is available, choose which location levels to show.
3. Set the separators and **Show warehouse** option.
4. Select **Save format**.

These settings change the displayed location format only. The full stored QR Router location remains intact.

## Generate a picking sheet

1. Open **Picking**.
2. Choose **Order type**: **Customer order** or **Manufacturing order**, then search and select the exact order. The choices depend on your native Dolibarr read permissions; QR management permission is not required to view or print a sheet.
3. Choose the **Warehouse**.
4. Select **Generate preview**.
5. Review the proposed bins, products, QR entries and quantities. Item and product links open their details.
6. Select **Print / Save as PDF** to take the sheet to the warehouse.

For customer orders, the sheet uses requested quantities minus consumption already recorded by QR Router for that order, including pending picks. It does not use Dolibarr's remaining unshipped balance or reserve stock. Returns do not automatically reopen the allowance because they do not identify the order to credit. Record actual stock actions through the appropriate workflow.

For manufacturing orders, the sheet uses the planned component lines marked **to consume** on the order. Quantities are already scaled by Dolibarr; they are not multiplied by the finished-product quantity again. Finished products and recorded consumption/production lines are excluded. Previous consumption is not subtracted from the plan. Repeated component lines share available QR quantities, and shortages appear as **Not allocated**. Draft orders without component lines show an empty-preview message; configure the components in Dolibarr first.

## Save and resume a customer-order pick list

Select **Save pick list** to retain the requested product quantities and source warehouse. **Saved pick lists** shows requested, QR-picked, pending, manually fulfilled and remaining quantities, with open, in-progress and completed statuses. Lists survive refreshes and service restarts. There is one saved list per customer order, with quantities captured when first saved. Manufacturing-order sheets remain planning previews.

Use **Resume picking**, or **Pick with scanner safeguards** from a customer-order preview, to open consumption against that order. Loading a list also saves it. Only allocated QR labels in the selected warehouse are accepted, and quantities cannot exceed the allocation. The server checks again when committing each item, counting other operators' completed and pending picks. Reload when allocations change. Scanner checks also reject items ineligible for the selected workflow.

## Complete a list using untracked stock

When remaining quantities have been supplied from stock outside QR tracking, select **Complete manually**, enter a reason and select **Confirm manual completion**. This records the remaining quantities as manually fulfilled, retaining the user, time and reason. It does not register items or post stock movements; record any required native stock adjustment separately in Dolibarr. Resolve pending picks before completing manually. Completed lists cannot be picked again through the guarded workflow.

## Open QR entries from Dolibarr

1. Open a product, warehouse or lot/serial card in Dolibarr.
2. Select its **QR entries** tab or action to view related QR items. The warehouse menu also provides **QR entries** near the location actions.
3. Select a QR entry to open its detail page.

Employee cards link to current QR loans. Customer orders, manufacturing orders and shipment cards link to QR entries with saved transaction references. Related lists respect your native Dolibarr permissions.

## Configure internal locations

1. Open **Bins and locations** and choose the warehouse.
2. Under **Location levels**, edit each level name in its numbered row. Select **Add level** for another row, such as Rack or Shelf, then **Save location levels**. Up to eight levels are supported. Blank and duplicate names must be corrected before saving. Unsaved new rows can be removed; existing identities and options are retained. Save before assigning items. A new warehouse starts with a single free-text **Location** field.
3. Choose a **Data type** per row: **Text** for free-form values, **Number** for numeric values, **Letters (A–Z)** for letter choices, or **Option list** for named choices. New letter levels start with A–Z; add AA, AB or other letter sequences if needed. For option lists, enter one option per line. Numeric values are checked when assigning a location.
4. You can append levels later. Datatypes can only change while that specific level has no saved assignments; existing option identities and locations are preserved. Levels already in use cannot be removed. For imported lists, use **Add location options** to add values without changing existing option identities.
5. To assign or change a location, select **Change location** beside an item, edit its location values and save. To move stock to another warehouse, use the scanner's **Move** action instead.
6. Native warehouse cards have a **Locations** link and tab. Product and serial/lot cards link to their QR entries, where **Change location** opens the same editor. The native serial list also links directly to associated QR items.

Definitions and assignments are saved in QR Router's service database. Dolibarr owns warehouse stock, quantities and serial/lot identities. A native stock move to a different warehouse clears the old QR location; assign a location in the new warehouse.

## Import existing locations once

With an administrator account and the old location module still available, select **Import Binloc locations** before configuring those warehouses in QR Router. The import copies definitions and assignments for QR-associated lots, preserving warehouses already configured in QR Router. It rejects mismatched stock warehouses or an import with no new warehouses, and rolls back on failure. Verify the result before disabling Binloc. Future location edits are internal and are not written back to Binloc.
