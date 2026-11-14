# Barcode carriers and label layouts

## Identity stays independent of rendering

New item identifiers still contain five random characters and the existing checksum character. The alphabet, checksum, database keys, native serials and legacy identifier support have not changed. Printing the same item in another symbology encodes the same identifier; it does not create an alias, replace a QR record or post stock.

Numeric-looking IDs are still strings. PHP converts all-digit array keys to integers, so adapter code lists use `qrr_item_codes()` before serializing visibility scopes or query candidates. Do not pass those keys directly as JSON numbers to C# string fields.

`assets/barcode-formats.json` is the shared list of supported carriers. The bootstrap exposes it as `barcode_formats`. Item labels support QR Code (`QRCODE`), Data Matrix (`DATAMATRIX`), Code 128 (`C128`) and PDF417 (`PDF417`). Numeric-only encodings such as EAN-13/UPC and numeric Code 128 subsets are not options for these alphanumeric IDs.

Printer size (`format`) and carrier (`symbology`) are independent query parameters. Empty symbology defaults to QR so existing links and printed labels remain useful. Individual and batch print pages expose the selector, preserve it during language/size/A4 changes and keep the human-readable ID complete.

Storage-location and physical-bin labels keep their existing typed route payloads and entity checks. Their print selector offers QR and Data Matrix, suitable for those longer payloads within the fixed square code area. A location label identifies a location choice; a physical-bin label identifies the movable bin. Neither becomes an ordinary item ID.

## Native rendering boundary

`qrrouter_barcodes.lib.php` validates the carrier against the shared list, uses Dolibarr's `modTcpdfbarcode::getTcpdfEncodingType()` mapping and instantiates the bundled TCPDF 1D/2D renderer. The Barcode engine can be used as a rendering utility without enabling native product-barcode editing. QR Router does not assign or overwrite a native product barcode when printing its own identifier.

`barcode.php` checks the same base inventory/object access as the original image endpoint and returns SVG. SVG remains sharp at printer resolution and does not need GD. It accepts an authorized item code or the existing location/bin selectors, not arbitrary user-supplied barcode text. Unsupported carriers are rejected before rendering; renderer errors are logged without disclosing internals in the response.

`qr.php` remains a compatibility entry point producing PNG through the shared renderer. It retains the existing PHP GD requirement for PNG output. Image access is checked independently of the Print grant on the print pages, as it also serves item details. All new print-page format selection is read-only.

## Layout rules

| Label                    | Barcode placement                                  | Information placement                                                        |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Compact 2D thermal label | Left                                               | To the right                                                                 |
| Larger 2D thermal label  | Top-left                                           | Primary name/serial/reference to the right; secondary fields span the bottom |
| 1D thermal label         | Full-width band along the bottom, with readable ID | Above the barcode                                                            |
| A4 2D label              | Top-left                                           | Identification to the right and secondary details underneath                 |
| A4 1D label              | Bottom                                             | Identification/details above                                                 |

`frontend/src/print/main.ts` uses the carrier's `layout` classification rather than guessing from image dimensions. PDF417 is a 2D carrier even though its image can be wide. Images preserve their aspect ratio; 1D bars must not be stretched into squares. Physical label dimensions are still defined by the existing profiles. Detail fitting may reduce/truncate descriptive text, while the stored and readable identifier remains intact.

`thermal-labels.css` and `a4-labels.css` implement the placement rules. The larger thermal layout separates primary and secondary containers so the lower-left area is usable. Unassigned labels contain the barcode and ID without invented product details.

## Camera and hardware scanning

`BarcodeDecoder` decodes RGBA frames without changing their payload. The existing `jsQR` path handles QR; ZXing readers handle Data Matrix, Code 128 and PDF417. Non-QR frames are converted to luminance, tried in normal/inverted colors and rotated once to support vertical linear barcodes. Expected no-match/checksum/format exceptions are ordinary frame misses; unrelated errors are not suppressed.

`ScannerComponent` bounds frame size and decode frequency and retains its generation-based camera cleanup. The decoded text still passes through `normalizeCode`, identifier/checksum or typed-payload validation, feature eligibility checks and server authorization. Adding a carrier does not make arbitrary external product barcodes valid item identifiers.

Manual/USB entry follows the same payload validation. A hardware scanner needs support for the printed carrier and should send the decoded value as keyboard input. Adequate focus, contrast, quiet zones and module resolution remain necessary for reliable camera or hardware reading.

## Verification and extension

- `npm run test:barcodes` round-trips independent BWIPP encoders through the production decoder, including numeric-looking and mixed IDs, rotations, inversion and blank frames.
- Mock camera tests exercise the actual capture pipeline and selection without mutating identifiers. The developer camera toolbar includes a carrier selector and preserves image aspect ratio.
- Native compatibility checks exercise the official engine mapping and SVG rendering for each supported Dolibarr version. Prepare the pinned source cache with `python tests/dolibarr_compatibility.py --download --php /path/to/php` before gateway tests.
- Gateway tests use those official renderers, verify allowlists/access checks and assert that rendering does not modify service state.
- Production-hosted browser tests decode native-generated images back to their IDs and check placement, dimensions and text bounds.

To add another carrier, check that it represents every supported identifier/payload, add a tested native mapping and decoder, classify its layout and test actual printed rendering. Do not weaken the ID validator or change persisted IDs just to fit a restricted encoding.
