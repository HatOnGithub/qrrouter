<?php
/** Manual-to-camera return links must preserve only valid QR operation context. */
error_reporting(E_ALL);
define('DOL_DOCUMENT_ROOT', sys_get_temp_dir().'/qrr-manual-context');
function dol_buildpath($route, $type) { return '/custom'.(string)$route; }
require_once __DIR__.'/../lib/qrrouter.lib.php';
function manualAssert($value, $expected, $context) {
    if ($value !== $expected) throw new RuntimeException($context.' expected '.$expected.', got '.$value);
}
$base='/custom/qrrouter/';
foreach (array('unique','generic','box') as $mode) {
    $link=qrr_manual_camera_return('register',$mode);
    manualAssert($link['url'], $base.'register.php?mode='.$mode, 'register '.$mode);
}
$copy='ITM-ABCDEF123';
manualAssert(qrr_manual_camera_return('register','unique','','',$copy)['url'],
             $base.'register.php?mode=unique&copy='.$copy,'copied registration');
foreach (array('move','consume','checkout','checkin') as $action) {
    $link=qrr_manual_camera_return('workflow','',$action);
    manualAssert($link['url'],$base.'workflow.php?action='.$action,'workflow '.$action);
}
$from='BOX-ABCDEF123';
manualAssert(qrr_manual_camera_return('boxdest','','',$from)['url'],
             $base.'camera.php?mode=boxdest&from='.$from, 'box destination');
manualAssert(qrr_manual_camera_return('lookup')['url'],$base.'camera.php','generic lookup');
foreach (array(
   array('workflow','','../../admin','', ''),
   array('register','other','','',''),
   array('boxdest','','','bad-key',''),
   array('lookup','unique','consume','',''),
) as $args) {
    manualAssert(qrr_manual_camera_return(...$args)['url'],$base.'camera.php','invalid or mixed context fallback');
}
manualAssert(qrr_manual_camera_return('register','unique','','','not-valid')['url'],
             $base.'register.php?mode=unique','invalid copy must be dropped');
echo "Manual-entry camera context routes passed.\n";
