<?php
define('DOL_DOCUMENT_ROOT', __DIR__);
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter.lib.php';
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter_labels.lib.php';
$checks = 0;
function label_check($condition, $description) {
    global $checks;
    if (!$condition) {
        throw new RuntimeException($description);
    }
    $checks++;
}
function dol_buildpath($path, $type = 0) {
    return '/custom' . $path;
}
foreach (qrr_label_profiles() as $profile) {
    label_check(qrr_label_format($profile['id']) === $profile['id'], 'Configured formats accepted');
    label_check(
        $profile['width'] > $profile['qr'] && $profile['height'] > $profile['qr'],
        'QR fits physical label',
    );
    label_check($profile['detail_limit'] >= 3, 'Assigned label has room for identification');
}
label_check(qrr_label_format('') === 'a4', 'Default A4 profile');
label_check(qrr_barcode_format('')['id'] === 'QRCODE', 'Existing print links retain QR by default');
label_check(
    qrr_item_codes([222263 => [], 'ABCDEF' => []]) === ['222263', 'ABCDEF'],
    'Numeric-looking identifiers remain strings in public scopes',
);
foreach (['QRCODE', 'DATAMATRIX', 'C128', 'PDF417'] as $symbology) {
    label_check(
        qrr_barcode_format($symbology)['id'] === $symbology,
        'Alphanumeric barcode format accepted',
    );
}
foreach (['EAN13', 'UPC', 'C128C', '../QRCODE', '0'] as $symbology) {
    try {
        qrr_barcode_format($symbology);
        throw new LogicException('Unsupported format accepted');
    } catch (InvalidArgumentException $error) {
        $checks++;
    }
}
label_check(
    array_column(qrr_barcode_formats(true), 'id') === ['QRCODE', 'DATAMATRIX'],
    'Long route labels use compact formats',
);
print 'Passed ' . $checks . " label profile checks.\n";
