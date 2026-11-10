# Employee loans

[Guide index](README.md)

## View loans

1. Open **Loans**.
2. Search or filter by warehouse and item type as in Inventory.
3. Check the borrower shown in the status and select an item for its loan details.
4. Use **Check in** on the item to return it, or use **Scan QR > Check in items** for several items.

For step-by-step loan actions, see [Check out items](scanner.md#check-out-items-to-an-employee) and [Check in items](scanner.md#check-in-employee-loans).

## Manage personal warehouses

This page requires administrator permission. Each employee uses a separate native Dolibarr warehouse for loans.

1. Return that employee's outstanding loans and reconcile pending transfers before changing a mapping.
2. Open **Personal warehouses**.
3. Choose the **Employee** and their **Warehouse**.
4. Select **Save mapping** and check the table below.
5. To remove a mapping, choose the employee, select **Remove mapping**, then **Save mapping**.

If no employees are listed, create active employee users in Dolibarr first. The checkout workflow can create a personal warehouse when a mapping does not yet exist and the operator has the required permissions.
