<?php
/** Serve stored JPEGs only after the QR/native visibility checks, never by an unchecked path. */
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    die('Missing Dolibarr main.inc.php');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
if (!qrr_inventory_right($user)) {
    accessforbidden();
}
$code = qrr_input_code(GETPOST('code', 'alphanohtml'));
if (!qrr_code_valid($code) || !isset(qrr_browser_inventory($db)['state']['items'][$code])) {
    http_response_code(404);
    exit();
}
$file = qrr_thumbnail_path($code);
if (!is_file($file)) {
    http_response_code(404);
    exit();
}
header('Content-Type: image/jpeg');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Content-Length: ' . filesize($file));
readfile($file);
