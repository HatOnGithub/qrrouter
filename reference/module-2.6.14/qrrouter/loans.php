<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user)||!qrr_products_right($user))accessforbidden();
$state=qrr_load_state();$people=qrr_personal_users($db);$warehouses=qrr_warehouses($db);
qrr_layout_start('Checked-out items');
print '<table class="qrr-table"><thead><tr><th>Item / QR</th><th>Holder</th><th>Reason / since</th><th>Personal warehouse</th><th>Action</th></tr></thead><tbody>';
$count=0;
foreach($state['items'] as $e){$loan=qrr_loan_data($e);$pending=qrr_handoff_data($e);if(!$loan&&!$pending)continue;$count++;
 print '<tr><td>'.qrr_item_identity_html($e).'</td>';
 print '<td>'.qrr_h($people[(int)($loan['user_id']??$pending['person_id']??0)]??'Unknown').'</td>';
 print '<td>'.qrr_h(($loan['reason']??$pending['reason']??'').' / '.($loan['at']??$pending['at']??'')).'</td>';
 print '<td>'.qrr_h($warehouses[(int)$e['warehouse_id']]['ref']??'').'</td><td><a href="'.qrr_h(qrr_link('checkout.php',array('code'=>$e['code']))).'">'.($pending?'Reconcile':'Check in').'</a></td></tr>';
}
if(!$count)print '<tr><td colspan="5">No checked-out or pending QR records.</td></tr>';
print '</tbody></table>';qrr_layout_end();
