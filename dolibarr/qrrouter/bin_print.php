<?php
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    die('Dolibarr main.inc.php missing');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
require_once __DIR__ . '/lib/qrrouter_print.lib.php';
if (!qrr_inventory_right($user) || !qrr_locations_right($user)) {
    accessforbidden();
}
try {
    $locale = qrr_print_locale(GETPOST('lang', 'alphanohtml'));
} catch (InvalidArgumentException $error) {
    http_response_code(400);
    exit($error->getMessage());
}
$translations = qrr_print_translations($locale);
$pt = fn($text) => qrr_h($translations[$text] ?? $text);
$state = qrr_browser_inventory($db)['state'];
header('Cache-Control: no-store');
$warehouses = qrr_warehouses($db);
$wid = (int) GETPOST('warehouse_id', 'int');
if (!isset($warehouses[$wid])) {
    http_response_code(404);
    exit('Unknown warehouse');
}
$bin = trim((string) GETPOST('bin', 'alphanohtml'));
$levelId = (int) GETPOST('level_id', 'int');
$levelValue = (string) GETPOST('level_value', 'alphanohtml');
if (!qrr_bin_valid($bin)) {
    http_response_code(400);
    exit('Invalid bin code');
}
$bins = [$bin];
$products = qrr_products_index($db, array_column($state['items'], 'product_id'));
qrr_layout_start('Bin content sheets');
print '<style>@page{size:A5 portrait;margin:10mm}.qrr-binsheet{background:white;color:#111;padding:6mm;border:1px solid #aaa;min-height:172mm;box-sizing:border-box;page-break-after:always;font:11pt Arial,sans-serif}.qrr-binsheet h1{font-size:22pt;line-height:1.1;margin:0 0 3mm}.qrr-binsheet h2{font-size:13pt;margin:5mm 0 2mm}.qrr-binsheet table{border-collapse:collapse;width:100%;font-size:9.5pt}.qrr-binsheet th,.qrr-binsheet td{border-bottom:1px solid #ccc;padding:2mm;text-align:left;overflow-wrap:anywhere}.qrr-binsheet .qty{text-align:right;white-space:nowrap}.qrr-binsheet .meta{font-size:8pt;color:#555}.qrr-binsheet .warning{border:1px solid #b35b06;padding:2mm}.qrr-print-tool{margin:12px 0}@media print{.qrr>h2{display:none}body{background:white!important}.qrr-binsheet{border:0;padding:0;margin:0;min-height:0}.qrr-print-tool{display:none!important}.qrr{max-width:none!important}header,nav,footer,#id-left,.vmenu,.tabs,.qrr-noprint{display:none!important}}</style>';
print '<div class="qrr-print-tool qrr-noprint"><button class="qrr-btn" onclick="window.print()">' .
    $pt('Print / Save as PDF') .
    '</button> <a class="qrr-btn alt" href="' .
    qrr_h(
        qrr_app_link('locations', [
            'warehouse_id' => $wid,
            'bin' => $bin,
            'level_id' => $levelId,
            'level_value' => $levelValue,
        ]),
    ) .
    '">' .
    $pt('Back to bins') .
    '</a></div>';
foreach ($bins as $name) {
    $summary = qrr_bin_summary($state['items'], $wid, $name, $products, $levelId, $levelValue);
    $gen = 0;
    $box = 0;
    $unk = 0;
    foreach ($summary['totals'] as $row) {
        $gen += $row['generic'];
        $box += $row['box'];
        $unk += $row['unknown_boxes'];
    }
    print '<section class="qrr-binsheet"><div class="meta">QR ROUTER &nbsp; | &nbsp; ' .
        $pt('Warehouse') .
        ' ' .
        qrr_h($warehouses[$wid]['ref']) .
        ' &nbsp; | &nbsp; ' .
        $pt('Generated') .
        ' ' .
        qrr_h(gmdate('Y-m-d H:i') . ' UTC') .
        '</div>';
    $example = null;
    foreach ($state['items'] as $entry) {
        if (
            $name !== '' &&
            (int) ($entry['warehouse_id'] ?? 0) === $wid &&
            ($entry['bin'] ?? '') === $name
        ) {
            $example = $entry;
            break;
        }
    }
    $local = $example ? qrr_location_local_label($db, $wid, $example, $state) : $name;
    print '<h1>' .
        (!empty($summary['scope'])
            ? qrr_h($summary['scope'])
            : ($name === ''
                ? $pt('Warehouse inventory')
                : $pt('Bin') . ' ' . qrr_h($local))) .
        '</h1><div class="meta">' .
        ($local !== $name
            ? '<span class="qrr-noprint">' .
                $pt('Full location:') .
                ' ' .
                qrr_h($name) .
                ' | </span>'
            : '') .
        $pt('Inventory content list (QR-managed records)') .
        '</div>';
    foreach ($state['items'] as $pendingItem) {
        if (
            !empty($pendingItem['pending_handoff']) &&
            (int) $pendingItem['warehouse_id'] === $wid &&
            ($name === '' || (string) $pendingItem['bin'] === (string) $name) &&
            ($levelValue === '' ||
                strcasecmp(
                    trim((string) ($pendingItem['bin_values'][$levelId] ?? '')),
                    trim($levelValue),
                ) === 0)
        ) {
            print '<p class="warning">' .
                $pt('A native warehouse transfer is pending for QR') .
                ' ' .
                qrr_h($pendingItem['code']) .
                '. ' .
                $pt('This item is excluded from the printout until reconciled.') .
                '</p>';
        }
    }
    print '<h2>' . $pt('Individually tracked items') . ' — ' . count($summary['tracked']) . '</h2>';
    print '<table><thead><tr><th>' .
        $pt('Item / product') .
        '</th><th>' .
        $pt('QR or serial / details') .
        '</th></tr></thead><tbody>';
    foreach ($summary['tracked'] as $row) {
        $p = $row['_product'];
        print '<tr><td><b>' .
            qrr_h($row['label'] ?: $p['label'] ?: $p['ref']) .
            '</b><div class="meta">' .
            qrr_h($p['ref']) .
            '</div></td>';
        print '<td><span class="meta">QR ' .
            qrr_h($row['code']) .
            '</span>' .
            ($row['serial']
                ? '<div>' . $pt('Serial / ID:') . ' ' . qrr_h($row['serial']) . '</div>'
                : '') .
            ($row['details'] ? '<div>' . nl2br(qrr_h($row['details'])) . '</div>' : '') .
            '</td></tr>';
    }
    if (!$summary['tracked']) {
        print '<tr><td colspan="2">' . $pt('None') . '</td></tr>';
    }
    print '</tbody></table><h2>' .
        $pt('Tracked generic items and counted containers') .
        ' — ' .
        $pt('summed by product') .
        '</h2>';
    print '<table><thead><tr><th>' .
        $pt('Product') .
        '</th><th class="qty">' .
        $pt('Loose (QR)') .
        '</th><th class="qty">' .
        $pt('Containers') .
        '</th><th class="qty">' .
        $pt('Total known') .
        '</th></tr></thead><tbody>';
    foreach ($summary['totals'] as $t) {
        print '<tr><td><b>' .
            qrr_h($t['product']['ref']) .
            '</b><div class="meta">' .
            qrr_h($t['product']['label']) .
            '</div></td>';
        print '<td class="qty">' .
            (int) $t['generic'] .
            '</td><td class="qty">' .
            (int) $t['box'] .
            '</td><td class="qty"><b>' .
            ($t['generic'] + $t['box']) .
            '</b>' .
            ($t['unknown_boxes'] ? ' + ?' : '') .
            '</td></tr>';
    }
    if (!$summary['totals']) {
        print '<tr><td colspan="4">' . $pt('None') . '</td></tr>';
    }
    print '</tbody></table><p><b>' .
        $pt('Known counts:') .
        '</b> ' .
        count($summary['tracked']) .
        ' ' .
        $pt('individually tracked,') .
        ' ' .
        $gen .
        ' ' .
        $pt('generic units,') .
        ' ' .
        $box .
        ' ' .
        $pt('units in containers.') .
        '</p>';
    if ($unk) {
        print '<p class="warning"><b>' .
            $pt('Count required:') .
            '</b> ' .
            $unk .
            ' ' .
            $pt('container(s) have unknown quantities. Totals above are incomplete.') .
            '</p>';
    }
    print '<p class="meta">' .
        $pt(
            'Locations are positions managed in QR Router. Actual warehouse stock is maintained separately in Dolibarr. Please reconcile before relying on this sheet for stock valuation.',
        ) .
        '</p>';
    print '</section>';
}
qrr_print_data($locale, [
    'warehouse_id' => $wid,
    'bin' => $bin,
    'level_id' => $levelId,
    'level_value' => $levelValue,
]);
qrr_layout_end(false);
