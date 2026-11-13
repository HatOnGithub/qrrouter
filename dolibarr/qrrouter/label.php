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
qrr_print_document(
    $db,
    [$item],
    'Print QR label',
    $format,
    qrr_link('label.php', ['code' => $code, 'format' => 'a4']),
    qrr_app_link('items/' . $code),
    ['code' => $code],
);
