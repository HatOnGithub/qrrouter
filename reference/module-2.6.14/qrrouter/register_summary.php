<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user))accessforbidden();
$state=qrr_load_state();$codes=$_SESSION['qrr_round_codes']??array();$warehouses=qrr_warehouses($db);
qrr_layout_start('Registration summary');
print '<div class="qrr-panel"><h3>'.count($codes).' registered item(s)</h3><table class="qrr-table"><thead><tr><th>Scan</th><th>Item / QR</th><th>Type</th><th>Location</th><th>Quantity</th></tr></thead><tbody>';
foreach($codes as $code){$item=$state['items'][$code]??null;if(!$item)continue;print '<tr><td><img class="qrr-scan-thumb" style="width:64px;height:64px" src="'.qrr_h(qrr_thumbnail_url($code)).'" alt="QR thumbnail"></td><td>'.qrr_item_identity_html($item).'</td><td>'.qrr_h($item['type']).'</td><td>'.qrr_h(($warehouses[(int)$item['warehouse_id']]['ref']??'').' / '.$item['bin']).'</td><td>'.(int)qrr_qty($item).'</td></tr>';}
print '</tbody></table><p class="qrr-flex"><a class="qrr-btn" href="'.qrr_h(qrr_link('register.php',array('start'=>1))).'">Register more items</a><a class="qrr-btn alt" href="'.qrr_h(qrr_link('print_codes.php')).'">Print more QR codes</a><a class="qrr-btn alt" href="'.qrr_h(qrr_link('batches.php')).'">Unregistered QR batches</a></p></div>';
qrr_layout_end();
