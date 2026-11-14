<?php
/** Authorized barcode images. The selected format changes rendering, never the stored ID. */
$res = is_file(__DIR__ . '/../../main.inc.php') ? include __DIR__ . '/../../main.inc.php' : 0;
if (!$res) {
    die('Missing Dolibarr main.inc.php');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
require_once __DIR__ . '/lib/qrrouter_barcodes.lib.php';
if (!qrr_inventory_right($user)) {
    accessforbidden();
}
try {
    $location = (string) GETPOST('location', 'alphanohtml');
    $physicalBin = (string) GETPOST('physical_bin', 'alphanohtml');
    $format = qrr_barcode_format(
        GETPOST('symbology', 'alphanohtml'),
        $location !== '' || $physicalBin !== '',
    );
    if ($physicalBin !== '') {
        $bin = qrr_physical_bin($db, $physicalBin);
        $payload = qrr_absolute_app_url('bins', ['physical_bin' => $bin['qr']]);
    } elseif ($location !== '') {
        qrr_resolve_location_qr($db, $location);
        $payload = qrr_location_qr_url($location);
    } else {
        $payload = qrr_input_code(GETPOST('code', 'alphanohtml'));
        if (
            !qrr_code_valid($payload) ||
            !isset(qrr_browser_inventory($db)['state']['items'][$payload])
        ) {
            http_response_code(404);
            exit('Invalid identifier');
        }
    }
    $png = defined('QRR_LEGACY_QR_IMAGE');
    $image = qrr_barcode_image($payload, $format['id'], $png);
    header('Content-Type: ' . ($png ? 'image/png' : 'image/svg+xml; charset=UTF-8'));
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo $image;
} catch (Throwable $error) {
    if (!($error instanceof DomainException) && !($error instanceof InvalidArgumentException)) {
        dol_syslog('Barcode rendering failed: ' . $error->getMessage(), LOG_ERR);
    }
    http_response_code(
        $error instanceof DomainException
            ? 403
            : ($error instanceof InvalidArgumentException
                ? 400
                : 500),
    );
    echo 'Barcode image unavailable';
}
