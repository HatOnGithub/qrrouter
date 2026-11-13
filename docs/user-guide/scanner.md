# Scanner workflows

[Guide index](README.md)

## Camera and manual / USB entry

1. Open **Scan QR** and select **QR camera**, **Manual / USB entry**, or a warehouse action.
2. In camera mode, allow camera access and hold the QR item label inside the frame. Each accepted ID appears in the selection.
3. To use a USB scanner or keyboard, select **Manual / USB entry**. Focus **QR identifiers**, scan or enter the QR ID, then press Enter or **Add codes**. The printed QR URL is also accepted.
4. Repeat for the items you need. Duplicate scans do not add the same ID twice. Select an ID in the list to remove it.
5. Use **QR camera** to return to the camera page, or **Stop camera** to stop capture. If needed, select **Start camera** or **Restart camera**.

Changing input mode preserves the selection. The camera stops when you leave capture. Enter QR IDs, rather than product references or serial numbers, in the scanner field.

## Look up scanned items

1. Open **Scan QR > QR camera** or **Manual / USB entry**.
2. Add the desired QR IDs.
3. Select **Review selected items**.
4. Use **Previous** and **Next** to inspect each result and open its item details where available.
5. Use **Change selection** to return to capture.

This lookup does not change stock.

## Register items

1. Print blank labels if needed, then open **Scan QR > Register items**.
2. Scan or enter all labels you want to assign.
3. Select **Assign details** to open the separate details page.
4. Choose **QR type**, product, warehouse and QR Router location.
5. For a generic unit, leave the item name blank for the product short name or enter an override. Several selected labels can share these details.
6. For an individual or container, register one QR at a time. Enter the individual name and serial options, or the box lot name and quantity.
7. Review any serial warning, then select **Save**. Use **Change selection** to return without losing the details draft.
8. Check the saved item or registration notice.

An existing serial must have no QR association. Linking it preserves its native stock; a newly entered or automatically generated serial receives one unit. To register an existing box lot, its native warehouse quantity must match the entered quantity. Receive existing box stock into the correct lot in Dolibarr first.

## Move items

1. Open **Scan QR > Move items**.
2. Scan all items to move, then select **Review selected items**.
3. Check the selected rows and their current locations; deselect anything to leave behind.
4. Choose **Destination warehouse** and its QR Router location fields. Choose the same warehouse for a bin-only move.
5. Enter **Reason / purpose** if useful.
6. Select **Confirm operation** and check each result.

This moves the selected item or container to the chosen location; use a contents transfer when only some contents should move between boxes.

## Consume items

1. Open **Scan QR > Consume items**.
2. Scan the items and select **Review selected items**.
3. Check the selection and enter the quantity to consume from each item. An individual serial represents at most one unit.
4. Choose **Transaction reference**: **Customer order**, **Manufacturing order**, **Shipment**, or **None**, according to your permissions.
5. If a reference type is selected, search **Select an exact record** and select the matching record. Changing the type clears the previous record.
6. Enter **Reason / purpose**.
7. Check **Post native Dolibarr stock movement**. Linked serials and boxes always update native stock. For other items, disable it only when the native transaction has already adjusted stock.
8. Select **Confirm operation** and inspect the results and remaining quantities.

The selected reference and reason appear in the item history.

## Return consumed stock

1. Open **Scan QR > Return items**, or select **Return** on a consumed item's detail page.
2. Add the relevant QR IDs and select **Review selected items**.
3. Enter the quantities to restore, within the item's consumed quantity.
4. Choose **Destination warehouse**, QR Router location and **Reason / purpose**.
5. Review **Post native Dolibarr stock movement** as described for consumption.
6. Select **Confirm operation** and check the restored quantities.

To return an employee loan, use **Check in items** instead.

## Check out items to an employee

1. Open **Scan QR > Check out items**.
2. Scan the items and select **Review selected items**.
3. Check the selection, choose **Employee** and enter **Reason / purpose**.
4. Select **Confirm operation**.
5. Check the results and open **Loans** to verify the borrower.

Items move to that employee's personal warehouse. If no mapping exists, the workflow creates one when permitted. If there are no eligible employees, ask an administrator to create active employee users in Dolibarr.

## Check in employee loans

1. Open **Scan QR > Check in items**, or open an item in **Loans** and select **Check in**.
2. Scan any additional loaned items and select **Review selected items**.
3. Verify the loans selected for return and enter a reason if needed.
4. Select **Confirm operation**.
5. Confirm that the items return to their recorded original warehouses and disappear from **Loans**.

## Correct a container quantity

1. Open **Scan QR > Correct container quantity**.
2. Scan the container and select **Review selected items**.
3. Enter the actual counted quantity, including zero for an empty box. This is the new total, not the amount to add or subtract.
4. Check the displayed **Difference** and enter **Reason / purpose** explaining the count.
5. Select **Confirm operation** and verify the new total.

For an unknown QR-only count shown as `?`, the first count establishes the QR quantity without changing native stock. Corrections to linked native lots update Dolibarr stock.

## Transfer contents between containers

1. Open **Scan QR > Transfer contents between containers**.
2. Scan exactly two boxes: **source first**, then destination.
3. Select **Review selected items** and check the **Source** and **Destination** markers.
4. Confirm that both boxes hold the same product in the same warehouse.
5. Enter the quantity to transfer on the source row, within its available quantity. The destination quantity control is disabled.
6. Select **Confirm operation**.
7. Check that the source decreased and destination increased by the same amount. The warehouse's product total stays unchanged.

## Review results and start again

Check every row on **Operation results**. A failed item does not undo items already completed. Use **Start another round** for a new selection. For a pending or interrupted operation, follow [Setup and help](help.md); do not repeat the entire batch blindly.
