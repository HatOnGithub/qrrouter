# QR Router user guide

Open **QR Router** from Dolibarr. On a phone, use **Menu** to open the navigation. The names below use the English interface; translated installations show their local equivalents.

## Find the right instructions

| Interface area                                                     | Guide                                             |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| Inventory, item details, creating and editing                      | [Inventory and items](inventory.md)               |
| Print QR labels, blank batches, assigned batches and DYMO printing | [Labels and printing](labels.md)                  |
| Scan QR, manual / USB entry and every warehouse action             | [Scanner workflows](scanner.md)                   |
| Bins and locations, local label format and Picking                 | [Locations and picking](locations-and-picking.md) |
| Loans and Personal warehouses                                      | [Employee loans](loans.md)                        |
| Setup, refresh, permissions and pending operations                 | [Setup and help](help.md)                         |

## Before using stock actions

Your administrator must enable the module and grant the relevant Dolibarr permissions. Products and warehouses are selected from Dolibarr. Serial items and containers require products with lot/serial tracking enabled; locations use Binloc.

Choose the QR type that matches your use:

- **Tracked Individual:** one identifiable item, linked to its own Dolibarr serial.
- **Tracked Generic:** a product unit whose displayed name defaults to the Dolibarr product short name; you can override it in QR Router.
- **Counted Container:** a named box linked to a Dolibarr lot, holding a quantity of one product.
- **Unassigned printable label:** a QR label to register later.

The printed QR ID identifies the QR entry. A serial or box lot is a separate Dolibarr identity. Scan QR item labels for actions; choose bins in the location fields instead of scanning bin labels.

Use **Refresh** after changes made directly in Dolibarr. If an operation is pending, follow [Setup and help](help.md) before repeating it.
