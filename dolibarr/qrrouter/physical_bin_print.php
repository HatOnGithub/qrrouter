<?php
/** Print a movable bin identity, which stays stable when its storage location changes. */
$res = is_file(__DIR__ . '/../../main.inc.php') ? include __DIR__ . '/../../main.inc.php' : 0;
if (!$res) {
    die('Dolibarr main.inc.php missing');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
require_once __DIR__ . '/lib/qrrouter_barcodes.lib.php';
if (!qrr_permission_right($user, 'print') || !qrr_locations_right($user)) {
    accessforbidden();
}
try {
    $symbology = qrr_barcode_format(GETPOST('symbology', 'alphanohtml'), true)['id'];
    $bin = qrr_physical_bin($db, (string) GETPOST('bin_id', 'alphanohtml'));
} catch (Throwable $e) {
    http_response_code($e instanceof InvalidArgumentException ? 400 : 403);
    exit('Physical bin unavailable');
}
header('Cache-Control: no-store');
qrr_layout_start('Physical bin label');
qrr_barcode_selector($symbology, ['bin_id' => $bin['id']], true);
print '<style>@page{size:101mm 54mm;margin:0}.qrr-physical-label{display:grid;grid-template-columns:38mm minmax(0,1fr);gap:4mm;align-items:center;width:101mm;height:54mm;padding:4mm;box-sizing:border-box;background:#fff;color:#000;overflow:hidden}.qrr-physical-label img{width:38mm;height:38mm;image-rendering:pixelated}.qrr-physical-label strong{font:700 20pt/1.15 Arial;overflow-wrap:anywhere}.qrr-physical-label small{display:block;font:10pt monospace;margin-top:3mm}@media print{header,nav,footer,#id-left,.vmenu,.tabs,.qrr-noprint{display:none!important}.qrr{max-width:none!important}body{margin:0!important}}</style>';
print '<p class="qrr-noprint"><button onclick="window.print()">Print / Save as PDF</button></p><article class="qrr-physical-label"><img src="' .
    qrr_h(
        qrr_link($symbology === 'QRCODE' ? 'qr.php' : 'barcode.php', [
            'physical_bin' => $bin['id'],
            'symbology' => $symbology,
        ]),
    ) .
    '" alt="Physical bin QR"><div><strong>' .
    qrr_h($bin['label']) .
    '</strong><small>BIN ' .
    qrr_h($bin['id']) .
    '</small></div></article>';
qrr_layout_end();
