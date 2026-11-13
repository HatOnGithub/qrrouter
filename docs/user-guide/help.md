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

Menu entries and actions depend on permissions. Ask an administrator to check QR read/manage rights and native product, stock, employee or document rights for the action you need. A read-only user can inspect permitted records but cannot perform management workflows.

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
