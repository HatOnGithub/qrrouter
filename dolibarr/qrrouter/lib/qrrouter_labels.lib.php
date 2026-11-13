<?php
/** Fixed-size roll labels printed through the workstation's DYMO printer driver. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_label_profiles() {
    static $profiles;
    if ($profiles === null) {
        $profiles = json_decode(
            file_get_contents(__DIR__ . '/../assets/label-profiles.json'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
    }
    return $profiles;
}

function qrr_label_profile($format) {
    foreach (qrr_label_profiles() as $profile) {
        if ($profile['id'] === $format) {
            return $profile;
        }
    }
    throw new InvalidArgumentException('Unknown label profile');
}

function qrr_label_format($value) {
    $format = (string) $value;
    if (
        !in_array($format, array_merge(['', 'a4'], array_column(qrr_label_profiles(), 'id')), true)
    ) {
        http_response_code(400);
        exit('Unknown label format');
    }
    return $format === '' ? 'a4' : $format;
}

/** Only authorize and serialize data here; TypeScript owns all print layout and fitting. */
function qrr_print_document(
    $db,
    $items,
    $title,
    $format,
    $a4Url,
    $backUrl,
    $selection = [],
    $batch = false
) {
    $words = [
        'DYMO 550 labels',
        'Print DYMO labels',
        'Print / Save as PDF',
        'Back to QR Router',
        'A4 layout',
        'Label size',
        'Apply size',
        'Product not assigned',
        'Reference not assigned',
        'QR label',
        'Lot',
        'Warehouse',
        'Bin',
        'Quantity',
        'Location',
        'Item',
        'Type',
        'Status',
        'Details',
        'Tracked Individual',
        'Tracked Generic',
        'Counted Container',
        'On loan',
        'Consumed',
        'In stock',
        'Loading QR images…',
        'No labels to print',
        'Labels ready. Long details may be shortened; the QR ID is always complete.',
        'QR image failed to load. Refresh before printing.',
        'Select your printer and matching label paper in the print dialog. Use landscape orientation, 100% scale, no margins, and turn off headers and footers.',
    ];
    $translations = [];
    foreach ($words as $word) {
        $translations[$word] = qrr_t($word);
    }
    $payload = [
        'items' => array_values($items),
        'products' => (object) qrr_products_index($db, array_column($items, 'product_id')),
        'warehouses' => (object) qrr_warehouses($db),
        'profiles' => qrr_label_profiles(),
        'format' => $format,
        'title' => qrr_t($title),
        'base' => rtrim(qrr_base(), '/') . '/',
        'back' => $backUrl,
        'a4' => $a4Url,
        'selection' => (object) $selection,
        'batch' => (bool) $batch,
        'translations' => (object) $translations,
    ];
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    print '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    foreach (['thermal-labels.css', 'a4-labels.css'] as $css) {
        print '<link rel="stylesheet" href="' . qrr_h(qrr_base() . 'assets/' . $css) . '">';
    }
    print '</head><body><script id="qrr-print-data" type="application/json">' .
        json_encode(
            $payload,
            JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR,
        ) .
        '</script><script type="module" src="' .
        qrr_h(qrr_base() . 'spa/print/main.js') .
        '"></script>' .
        '<noscript>' .
        qrr_h(qrr_t('JavaScript is required to prepare this print layout.')) .
        '</noscript></body></html>';
}
