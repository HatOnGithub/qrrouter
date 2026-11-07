<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user))accessforbidden();
$wid=(int)GETPOST('warehouse_id','int');header('Content-Type: text/html; charset=UTF-8');header('Cache-Control: no-store');
try {$wh=qrr_warehouses($db);if($wid&&!isset($wh[$wid]))throw new RuntimeException('Unknown warehouse');echo qrr_binloc_levels_form($db,$wid);}catch(Throwable $e){http_response_code(422);echo '<div class="qrr-alert">'.qrr_h($e->getMessage()).'</div>';}
