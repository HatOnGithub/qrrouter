<?php
/** Check presentation priority without depending on Dolibarr or altering stock. */
error_reporting(E_ALL);
define('DOL_DOCUMENT_ROOT', __DIR__);
define('DOL_DATA_ROOT', sys_get_temp_dir());
$conf = (object)array('entity' => 1);
function dol_buildpath($path, $type=0) { return ($type === 1 ? '/custom' : __DIR__.'/custom').$path; }
require_once __DIR__.'/../lib/qrrouter.lib.php';
function require_identity($condition, $message) { if (!$condition) throw new RuntimeException($message); }
$code = 'ITM-ABCDEF';
$named = qrr_make_item($code,'tracked','DeltaCube sensor A',0,1);
require_identity(qrr_item_display_name($named)==='DeltaCube sensor A','A known label must be primary');
$html = qrr_item_identity_html($named);
require_identity(strpos($html,'class="qrr-item-name"')!==false,'Missing primary name styling');
require_identity(strpos($html,'>DeltaCube sensor A</a>')!==false,'Label should be linked');
require_identity(strpos($html,'<small class="qrr-item-id">QR ITM-ABCDEF</small>')!==false,'QR code must be secondary');
require_identity(strpos($html,'scan.php?code=ITM-ABCDEF')!==false,'Stable QR identifier should be used in the URL');
require_identity(strpos($html,'>ITM-ABCDEF</a>')===false,'QR ID must not replace known item label');
$unnamed = qrr_make_item($code,'tracked','');
require_identity(qrr_item_display_name($unnamed)===$code,'Unnamed items must fall back to QR ID');
require_identity(strpos(qrr_item_identity_html($unnamed),'<small class="qrr-item-id"')===false,'Do not display duplicate ID');
$unassigned = qrr_make_item($code,'unassigned');
require_identity(qrr_item_display_name($unassigned)===$code,'Unassigned labels should show QR ID');
$unassigned['label']='Stale value';
require_identity(qrr_item_display_name($unassigned)===$code,'Unassigned records should not prioritize stale label fields');
$unsafe = qrr_make_item($code,'tracked','<script>alert("x")</script>');
$escaped = qrr_item_identity_html($unsafe);
require_identity(strpos($escaped,'<script>')===false && strpos($escaped,'&lt;script&gt;')!==false,'Escape user-provided labels');
require_identity(qrr_item_display_name($unsafe)==='<script>alert("x")</script>','Display helper should not modify stored label');
$state = qrr_blank(); $state['items'][$code] = $named;
$preview = qrr_scan_review_table(array($code),$state,array(1=>array('ref'=>'MAIN')));
require_identity(strpos($preview,'DeltaCube sensor A')!==false,'Scan-review must show label');
require_identity(strpos($preview,'<small class="qrr-item-id">QR ITM-ABCDEF</small>')!==false,'Scan-review must keep the QR ID secondary');
require_identity(strpos($preview,'name="selected[]" value="ITM-ABCDEF"')!==false,'Selection must still use immutable QR ID');
require_identity(strpos($preview,'<th scope="col">Item / QR</th>')!==false,'Review table item label heading missing');
echo "Label-first identity rendering, scan review, stable key and escaping tests passed.\n";
