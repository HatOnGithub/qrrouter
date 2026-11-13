# Labels and printing

[Guide index](README.md)

## Print blank labels for later registration

1. Open **Print QR labels**.
2. Enter **Number of QR codes (1?200)**.
3. Select **Create batch**.
4. Under **Label batches**, choose **Printer / label format**.
5. Select **Print** beside your batch and complete the browser print dialog.
6. Attach the labels, then use **Scan QR > Register items** to assign them.

Unassigned printed labels contain only the QR image and QR ID.

To delete an unused QR code, filter **Inventory** by **Unassigned**, open the QR item, select **Delete unassigned QR code** and confirm. Assigned items cannot be deleted. The code is removed from its print batch; an empty batch is removed too. Printed copies of the deleted code are no longer registered. The deletion remains in the audit history.

## Create an assigned batch

1. Open **Print QR labels > Create assigned QR batch**.
2. Choose **QR type**, one shared **Dolibarr product**, **Warehouse** and location.
3. Complete the fields for the chosen type:
   - **Tracked Generic:** set **Number of labels**. Leave the name blank for the Dolibarr product short name, or enter one shared override.
   - **Tracked Individual:** enter one item name per line in **Individual labels (one per line)**. Each item gets its own automatically generated serial. Repeated names are allowed with automatic serials.
   - **Counted Container:** enter one unique box name per line and the quantity per box. Each name becomes a separate native lot.
4. New individuals always receive a random serial independent of their name and QR ID. Repeated item names are allowed.
5. Check the number of entries and select **Create assigned batch**. Batches contain 1?200 labels.
6. In **Label batches**, choose the format and select **Print** for the new batch.

Individual batches receive one unit per new serial. Container batches receive the specified quantity per box. Correct any duplicate or validation warning before creating the batch.

## Print an existing item

1. Open its detail page from **Inventory** or a scan.
2. Select **Print label** for A4, or **DYMO label sizes** for the roll-label page.
3. On the roll-label page, choose the label size and print.

## Use a DYMO LabelWriter 550

1. Install and select the printer through your workstation's normal printer setup.
2. Load labels matching the chosen format: **25 ? 54**, **32 ? 57**, **36 ? 89** or **54 ? 101 mm** (height ? width).
3. Choose the matching format in QR Router.
4. In the browser print dialog, select the DYMO printer and matching paper size. Print at **100% / actual size**, with browser headers and footers disabled. Avoid scaling to fit another paper size.
5. Print one label first and check its boundaries and QR readability before printing a batch.

Printing uses the browser and printer driver. Assigned roll labels show the QR image and ID, then available details in priority order: short name, serial and product reference. Larger labels can show additional lot, location, quantity, status and item details. Long text is fitted or shortened within the label.

Item names allow up to 140 UTF-8 bytes; serials and box names allow up to 100. Accented characters can use more than one byte. Shorten the text when the form shows a limit warning.
