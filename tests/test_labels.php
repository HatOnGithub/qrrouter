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
    label_check($profile['width'] > $profile['qr'] && $profile['height'] > $profile['qr'], 'QR fits physical label');
    label_check($profile['detail_limit'] >= 3, 'Assigned label has room for identification');
}
label_check(qrr_label_format('') === 'a4', 'Default A4 profile');
print 'Passed ' . $checks . " label profile checks.\n";
