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

/** Keep available values in priority order, and mark missing data without inventing it. */
function qrr_label_details($item, $product = [], $format = 'dymo-25x54', $warehouse = '') {
    if (($item['type'] ?? '') === 'unassigned') {
        return [];
    }
    $serial = trim((string) ($item['serial'] ?? ''));
    if ($serial === '' && ($item['type'] ?? '') === 'tracked') {
        $serial = trim((string) ($item['native_batch'] ?? ''));
    }
    $name = trim((string) ($product['label'] ?? ''));
    $override = trim((string) ($item['label'] ?? ''));
    if (in_array($item['type'] ?? '', ['generic', 'tracked'], true) && $override !== '') {
        $name = $override;
    }
    if ($name === '') {
        $name = trim((string) ($item['label'] ?? ''));
    }
    $ref = trim((string) ($product['ref'] ?? ''));
    $details = [];
    foreach (['serial' => $serial, 'name' => $name, 'ref' => $ref] as $kind => $value) {
        if ($value !== '') {
            $details[] = ['kind' => $kind, 'value' => $value, 'missing' => false];
        }
    }
    if (count($details) < 2 && $name === '') {
        $details[] = [
            'kind' => 'name',
            'value' => qrr_t('Product not assigned'),
            'missing' => true,
        ];
    }
    if (count($details) < 2) {
        $details[] = [
            'kind' => 'ref',
            'value' => qrr_t('Reference not assigned'),
            'missing' => true,
        ];
    }
    $profile = qrr_label_profile($format);
    $extra = [];
    $add = function ($kind, $value) use (&$extra) {
        $value = trim((string) $value);
        if ($value !== '') {
            $extra[] = ['kind' => $kind, 'value' => $value, 'missing' => false];
        }
    };
    if ($profile['level'] >= 1) {
        $lot = trim((string) ($item['native_batch'] ?? ''));
        if ($lot !== $serial) {
            $add('lot', $lot);
        }
        if ($profile['level'] === 1) {
            $add('location', trim($warehouse . ' / ' . ($item['bin'] ?? ''), ' /'));
        } else {
            $add('warehouse', $warehouse);
            $add('bin', $item['bin'] ?? '');
        }
        if (($item['type'] ?? '') !== 'unassigned' && isset($item['qty'])) {
            $add('qty', $item['qty']);
        }
    }
    if ($profile['level'] >= 2 && trim((string) ($item['label'] ?? '')) !== $name) {
        $add('item', $item['label'] ?? '');
    }
    if ($profile['level'] >= 3) {
        $add(
            'type',
            qrr_t(
                [
                    'tracked' => 'Tracked Individual',
                    'box' => 'Counted Container',
                    'generic' => 'Tracked Generic',
                    'unassigned' => 'Unassigned printable label',
                ][$item['type'] ?? 'unassigned'] ?? '',
            ),
        );
        $add(
            'status',
            qrr_t(
                !empty($item['checkout'])
                    ? 'On loan'
                    : (($item['status'] ?? '') === 'consumed'
                        ? 'Consumed'
                        : (($item['type'] ?? '') === 'unassigned'
                            ? 'Unassigned'
                            : 'In stock')),
            ),
        );
        $add('details', $item['details'] ?? '');
    }
    return array_slice(array_merge($details, $extra), 0, $profile['detail_limit']);
}

function qrr_dymo_label($item, $product = [], $format = 'dymo-25x54', $warehouse = '') {
    $code = (string) $item['code'];
    $profile = qrr_label_profile($format);
    $details = qrr_label_details($item, $product, $format, $warehouse);
    $primaryCount = count(
        array_filter($details, function ($detail) {
            return in_array($detail['kind'], ['serial', 'name', 'ref'], true);
        }),
    );
    $hasNotes = in_array('details', array_column($details, 'kind'), true);
    $rows =
        $profile['level'] >= 2
            ? $primaryCount +
                (int) ceil((count($details) - $primaryCount - ($hasNotes ? 1 : 0)) / 2) +
                ($hasNotes ? 2 : 0)
            : count($details);
    $html =
        '<article class="qrr-thermal-label' .
        (($item['type'] ?? '') === 'unassigned' ? ' qrr-label-id-only' : '') .
        (strlen($code) > 16 ? ' long-id' : '') .
        '" aria-label="' .
        qrr_h(qrr_t('QR label') . ' ' . $code) .
        '"><div class="qrr-qr-column"><img src="' .
        qrr_h(qrr_link('qr.php', ['code' => $code])) .
        '" alt="' .
        qrr_h('QR ' . $code) .
        '" width="240" height="240"><strong class="qrr-id-code">' .
        qrr_h($code) .
        '</strong></div><div class="qrr-label-details" data-detail-count="' .
        count($details) .
        '" style="--detail-rows:' .
        $rows .
        '">';
    foreach ($details as $detail) {
        $prefixes = [
            'serial' => 'SN',
            'ref' => 'REF',
            'lot' => qrr_t('Lot'),
            'warehouse' => qrr_t('Warehouse'),
            'bin' => qrr_t('Bin'),
            'qty' => qrr_t('Quantity'),
            'location' => qrr_t('Location'),
            'item' => qrr_t('Item'),
            'type' => qrr_t('Type'),
            'status' => qrr_t('Status'),
            'details' => qrr_t('Details'),
        ];
        $prefix =
            !$detail['missing'] && isset($prefixes[$detail['kind']])
                ? $prefixes[$detail['kind']] . ' '
                : '';
        $html .=
            '<div class="qrr-label-detail ' .
            $detail['kind'] .
            ($detail['missing'] ? ' missing' : '') .
            '" data-kind="' .
            $detail['kind'] .
            '" title="' .
            qrr_h($detail['value']) .
            '"><span>' .
            qrr_h($prefix . $detail['value']) .
            '</span></div>';
    }
    return $html . '</div></article>';
}

function qrr_dymo_document(
    $db,
    $items,
    $title,
    $a4Url,
    $backUrl,
    $format = 'dymo-25x54',
    $selection = []
) {
    $profile = qrr_label_profile($format);
    $warehouses = $profile['level'] > 0 ? qrr_warehouses($db) : [];
    $products = qrr_products_index($db, array_column($items, 'product_id'));
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    print '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' .
        qrr_h(qrr_t($title)) .
        '</title><link rel="stylesheet" href="' .
        qrr_h(qrr_base() . 'assets/thermal-labels.css') .
        '"><style>@page{size:' .
        $profile['width'] .
        'mm ' .
        $profile['height'] .
        'mm;margin:0}:root{--label-width:' .
        $profile['width'] .
        'mm;--label-height:' .
        $profile['height'] .
        'mm;--qr-size:' .
        $profile['qr'] .
        'mm;--detail-font:' .
        $profile['font'] .
        'pt;--min-detail-font:' .
        ($profile['font'] - 2.5) .
        'pt}</style></head><body data-detail-level="' .
        $profile['level'] .
        '"><header class="qrr-print-controls"><h1>' .
        qrr_h(qrr_t('DYMO 550 labels')) .
        '</h1><p>' .
        $profile['width'] .
        ' × ' .
        $profile['height'] .
        ' mm · ' .
        qrr_h(qrr_t('One label per page')) .
        '</p><p>' .
        qrr_h(
            qrr_t(
                'Select your printer and matching label paper in the print dialog. Use landscape orientation, 100% scale, no margins, and turn off headers and footers.',
            ),
        ) .
        '</p><p>' .
        qrr_h(
            qrr_t(
                'Assigned labels show product details. Unassigned labels show only the QR code and QR ID.',
            ),
        ) .
        '</p><div class="qrr-print-actions"><button type="button" id="qrr-print" disabled>' .
        qrr_h(qrr_t('Print DYMO labels')) .
        '</button><a href="' .
        qrr_h($a4Url) .
        '">' .
        qrr_h(qrr_t('A4 layout')) .
        '</a><a href="' .
        qrr_h($backUrl) .
        '">' .
        qrr_h(qrr_t('Back to QR Router')) .
        '</a></div><p id="qrr-print-status" role="status" data-ready="' .
        qrr_h(qrr_t('Labels ready. Long details may be shortened; the QR ID is always complete.')) .
        '" data-error="' .
        qrr_h(qrr_t('QR image failed to load. Refresh before printing.')) .
        '">' .
        qrr_h(qrr_t($items ? 'Loading QR images…' : 'No labels to print')) .
        '</p><noscript>' .
        qrr_h(qrr_t('JavaScript is required to prepare this print layout.')) .
        '</noscript><form method="get" class="qrr-format-selector"><label for="qrr-label-size">' .
        qrr_h(qrr_t('Label size')) .
        '</label> <select id="qrr-label-size" name="format">';
    foreach (qrr_label_profiles() as $option) {
        print '<option value="' .
            qrr_h($option['id']) .
            '"' .
            ($option['id'] === $format ? ' selected' : '') .
            '>' .
            $option['height'] .
            ' × ' .
            $option['width'] .
            ' mm</option>';
    }
    print '</select>';
    foreach ($selection as $key => $value) {
        print '<input type="hidden" name="' . qrr_h($key) . '" value="' . qrr_h($value) . '">';
    }
    print ' <button type="submit">' .
        qrr_h(qrr_t('Apply size')) .
        '</button></form><p>' .
        qrr_h(
            qrr_t(
                'Larger labels add lot, location, quantity, status and item details when available.',
            ),
        ) .
        '</p></header><main class="qrr-roll">';
    foreach ($items as $item) {
        print qrr_dymo_label(
            $item,
            $products[(int) $item['product_id']] ?? [],
            $format,
            $warehouses[(int) ($item['warehouse_id'] ?? 0)]['ref'] ?? '',
        );
    }
    print '</main><script src="' .
        qrr_h(qrr_base() . 'assets/thermal-labels.js') .
        '" defer></script></body></html>';
}
