<?php
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    die('Missing Dolibarr main.inc.php');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
require_once __DIR__ . '/lib/qrrouter_labels.lib.php';
if (!qrr_inventory_right($user)) {
    accessforbidden();
}
$code = qrr_input_code(GETPOST('code', 'alphanohtml'));
$state = qrr_browser_inventory($db)['state'];
header('Cache-Control: no-store');
$item = $state['items'][$code] ?? null;
if (!$item) {
    http_response_code(404);
    exit('Label not found');
}
$img = qrr_link('qr.php', ['code' => $code]);
$format = qrr_label_format(GETPOST('format', 'alphanohtml'));
if ($format !== 'a4') {
    qrr_dymo_document(
        $db,
        [$item],
        'Print QR label',
        qrr_link('label.php', ['code' => $code, 'format' => 'a4']),
        qrr_app_link('items/' . $code),
        $format,
        ['code' => $code],
    );
    exit();
}
qrr_layout_start('Print QR label');
print '<div class="qrr-noprint"><button class="qrr-btn" onclick="window.print()">Print</button> <a class="qrr-btn alt" href="' .
    qrr_h(qrr_link('label.php', ['code' => $code, 'format' => 'dymo-25x54'])) .
    '">' .
    qrr_h(qrr_t('DYMO label sizes')) .
    '</a></div>';
print '<link rel="stylesheet" href="' . qrr_h(qrr_base() . 'assets/a4-labels.css') . '">';
$products = qrr_products_index($db, [(int) $item['product_id']]);
$printedName =
    ($item['type'] ?? '') === 'unassigned'
        ? $code
        : qrr_item_display_name($item, $products[(int) $item['product_id']] ?? []);
print '<div class="qrr-qr-label"><span class="qrr-printed-name">' .
    qrr_h($printedName) .
    '</span><div><img src="' .
    qrr_h($img) .
    '" alt="QR code"></div>' .
    ($printedName !== $code
        ? '<small class="qrr-printed-code">QR ' . qrr_h($code) . '</small>'
        : '') .
    '</div>';
qrr_layout_end();
