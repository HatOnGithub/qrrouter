# Setup and help

[Guide index](README.md)

For specific error messages, missing native receipt tables, warehouse validation failures and service diagnostics, see [Troubleshooting](../troubleshooting.md).

## Administrator connection settings

The module and its business service must be installed before this step.

1. Open QR Router's setup page from Dolibarr's module configuration.
2. Enter the **Service URL** and the **Service API key** supplied by the administrator running the service.
3. Select **Save**, then open QR Router and use **Refresh**.

When the URL is unchanged, leaving a previously saved API key blank keeps it. Re-enter the key when changing the URL.

## Missing pages or actions

Menu entries, direct pages and actions depend on permissions. All non-administrators need **Use QR Router**, **Read QR inventory and scan labels**, and native product/stock read access. Grant only the additional QR permissions needed for their tasks. Native object access, entity sharing and document permissions are checked separately; a QR grant never overrides a native restriction.

| QR permission    | Allows                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Create           | Create labels, register inventory and create physical bins                                                                                     |
| Modify           | Edit QR metadata and internal locations; pack or unpack items                                                                                  |
| Delete           | Delete unused, unassigned QR labels; native records and stocked QR items cannot be deleted here                                                |
| Move             | Move items and physical bins                                                                                                                   |
| Consume / Return | Perform the corresponding stock workflow                                                                                                       |
| Adjust           | Count or correct containers and transfer their contents                                                                                        |
| Loans            | Check items out to employees and check them back in                                                                                            |
| Picking          | Save and manually complete pick lists; guarded consumption also needs Consume                                                                  |
| Print            | Open label and inventory-report printouts                                                                                                      |
| Recovery         | Reconcile or recover pending operations; the original action's permission is also required                                                     |
| Configure        | Manage location definitions and label formats; connection settings, imports and employee mapping administration still require an administrator |
| History          | View permitted operation records on QR details and the history page                                                                            |

Native stock movements require **Stock > Create/modify stock movements**. Creating a new native lot or serial also requires native product-create permission. QR metadata edits do not write native stock or rename native lot/serial identities. Automatically creating an employee warehouse requires native warehouse-create permission. History requires native stock-movement read access as well as its QR permission. User and order selectors respect native employee and document access.

The former broad **manage** permission now controls configuration only. It does not imply Create, Modify, Delete or any stock workflow. Refresh the module's permission definitions after upgrading and explicitly grant module access and the required action rights to users or groups.

## Camera or entry problems

- Allow camera access in the browser. If capture fails, select **Start camera** or **Restart camera**, or switch to **Manual / USB entry**.
- For USB scanners, focus **QR identifiers** before scanning.
- Use the QR ID printed on the item label or its QR URL. A native serial, product reference or bin label is not a QR item ID.
- Remove an unwanted selected ID by selecting its button. An unknown label must be registered before stock actions can use it.

## Serial, quantity and print warnings

- An existing serial can be linked only if it has no QR association. Read its availability warning and verify the product and warehouse before saving.
- New tracked individuals receive random serials automatically. Existing serials can only be associated with one QR item.
- Shorten names when the form reports a text limit. See [Labels and printing](labels.md) for label sizes and limits.
- If linked lot stock is split across warehouses, consolidate it in Dolibarr before using that lot in QR Router.
- After a native record changes in Dolibarr, select **Refresh** before continuing.

## Pending synchronization banner

Open **More details** to see a table of the requested changes for each QR: the previous and intended values, including quantity and warehouse where relevant. An item's pending-operation notice also shows planned stock movements. These are the original requested changes; Dolibarr may already have applied them. Only records and locations you can access are included. Viewing details does not require the Recovery permission.

1. Let the original request finish. Do not submit the creation or stock action again.
2. Wait at least 30 seconds, then select **Recover synchronization** when available.
3. Refresh and check the resulting items. Recovery can finish an operation whose native stock changes already committed.
4. Use **Cancel uncommitted synchronization** only when no native transaction committed; the module rejects cancellation otherwise.

If recovery fails, keep the pending entry and contact the administrator with the displayed error.

## Pending operation on an item

1. Open the item's detail page.
2. Confirm that the original request has finished.
3. Select **Reconcile pending operation** if your stock permissions allow it.
4. Refresh and inspect the quantity, warehouse and operation status before proceeding.

For a batch with mixed results, completed items remain completed. Resolve the failed or pending rows individually instead of rerunning successful items.

## Action history

Administrators and users granted **View QR operation history** can open **Action history** to review inventory changes, registration, stock actions, physical-bin moves, pick-list activity and recovery. Entries show the time, acting user, operation, outcome and affected records, with quantity, location and reason where recorded. Started operations and their completion or cancellation appear as separate events; a started event alone does not establish completion.

The **Movement history** section on a QR's details page shows actions affecting that exact QR, with a refresh button and **Open operation history page** link. That link opens the separate page filtered to the same QR. Select **All QR entries** to return to the full history.

Administrators can grant **View QR operation history** through Dolibarr's user or group permissions for QR Router, alongside module access, inventory read access, native product/stock read and native stock-movement read permissions. This right does not grant inventory management or stock changes. After updating, if a new right is missing from the permissions screen, disable and re-enable the QR Router module to refresh its permission definitions.

Search by QR identifier, bin, location or reason, or filter by user, action and date range. Dates use the browser's local time; **Through date** includes that entire day. Use **Previous** and **Next** for older entries and **Apply filters / Refresh** to reload results. Links open affected items, physical bins and orders. Historical user and QR IDs remain visible when their current records are unavailable.

History is stored per entity in the service database and survives restarts. Viewing it does not change inventory or create action records. Scans, previews and rejected requests that made no changes are excluded. Non-administrators see only entries whose affected QR items, warehouses, bins and documents remain accessible through their native permissions. Older audit entries without verifiable visibility metadata and entries for unavailable records remain available to administrators.
