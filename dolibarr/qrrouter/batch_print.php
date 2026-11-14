<?php
/** Batch print entry: select only visible items before preparing the standalone print payload. */
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    die('Missing Dolibarr main.inc.php');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
require_once __DIR__ . '/lib/qrrouter_labels.lib.php';
if (!qrr_permission_right($user, 'print')) {
    accessforbidden();
}
$batch = strtoupper(trim((string) GETPOST('batch', 'alphanohtml')));
$state = qrr_browser_inventory($db)['state'];
header('Cache-Control: no-store');
$row = $state['batches'][$batch] ?? null;
$onlyUnassigned = (int) GETPOST('unassigned', 'int') === 1;
if (!$row) {
    http_response_code(404);
    exit('QR batch not found');
}
$printCodes = array_values(
    array_filter((array) $row['codes'], function ($code) use ($state, $onlyUnassigned) {
        return isset($state['items'][$code]) &&
            (!$onlyUnassigned || ($state['items'][$code]['type'] ?? '') === 'unassigned');
    }),
);
$format = qrr_label_format(GETPOST('format', 'alphanohtml'));
$items = array_map(fn($code) => $state['items'][$code], $printCodes);
qrr_print_document(
    $db,
    $items,
    'Printable QR batch',
    $format,
    qrr_link('batch_print.php', [
        'batch' => $batch,
        'unassigned' => $onlyUnassigned ? 1 : 0,
        'format' => 'a4',
    ]),
    qrr_app_link('labels'),
    ['batch' => $batch, 'unassigned' => $onlyUnassigned ? 1 : 0],
    true,
);
