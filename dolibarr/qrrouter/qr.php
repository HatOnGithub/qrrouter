<?php
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    die('Missing Dolibarr main.inc.php');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
if (!qrr_read_right($user)) {
    accessforbidden();
}
$code = qrr_input_code(GETPOST('code', 'alphanohtml'));
$state = qrr_load_state();
if (!qrr_code_valid($code) || !isset($state['items'][$code])) {
    http_response_code(404);
    exit('Invalid QR');
}
$path = DOL_DOCUMENT_ROOT . '/includes/tecnickcom/tcpdf/tcpdf_barcodes_2d.php';
if (!is_file($path)) {
    $path = DOL_DOCUMENT_ROOT . '/includes/tcpdf/tcpdf_barcodes_2d.php';
}
if (!is_file($path)) {
    http_response_code(500);
    exit('TCPDF2DBarcode missing');
}
require_once $path;
try {
    $obj = new TCPDF2DBarcode($code, 'QRCODE,H');
    $data = $obj->getBarcodePngData(5, 5, [0, 0, 0]);
    if (!$data) {
        throw new RuntimeException('QR renderer unavailable; install php-gd');
    }
    header('Content-Type: image/png');
    header('Cache-Control: private, max-age=180');
    header('X-Content-Type-Options: nosniff');
    echo $data;
} catch (Throwable $e) {
    http_response_code(500);
    exit('QR generation error');
}
