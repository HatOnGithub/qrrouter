<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user)||!qrr_products_right($user))accessforbidden();
$code=qrr_input_code(GETPOST('code','alphanohtml'));$state=qrr_load_state();$item=$state['items'][$code] ?? null;
if (!qrr_code_valid($code) || !$item) { http_response_code(404);qrr_layout_start('Unknown QR');print '<div class="qrr-alert">This QR code is not registered.</div>';qrr_layout_end();exit; }
$status=qrr_item_status($item);$warehouses=qrr_warehouses($db);$p = qrr_products_right($user) ? qrr_product($db,(int)$item['product_id']) : null;
qrr_layout_start('Item: '.qrr_item_display_name($item));
if(GETPOST('done','alphanohtml')==='checkout')print '<div class="qrr-ok">Stock checked out and transferred to the employee personal warehouse.</div>';
if(GETPOST('done','alphanohtml')==='checkin')print '<div class="qrr-ok">Stock checked in and transferred back to the original warehouse.</div>';
print '<div class="qrr-panel"><div class="qrr-flex" style="align-items:start"><img class="qrr-scan-thumb" src="'.qrr_h(qrr_thumbnail_url($code)).'" alt="QR scan thumbnail"><div><h2 class="qrr-item-heading">'.qrr_h(qrr_item_display_name($item)).'</h2>'.(qrr_item_display_name($item)!==$code?'<p class="qrr-item-code-muted">QR '.qrr_h($code).'</p>':'').'</div></div>';
print '<p><b>Type:</b> '.qrr_h(qrr_types()[$item['type']]).'</p>';
print '<p><b>Product:</b> '.($p ? qrr_h($p->ref.' — '.$p->label) : 'Unassigned or not accessible').'</p>';
$localBin=qrr_binloc_local_label($db,(int)$item['warehouse_id'],$item,$state);
print '<p><b>Warehouse:</b> '.qrr_h($warehouses[(int)$item['warehouse_id']]['ref'] ?? 'Unassigned').'</p><p><b>Local bin label:</b> '.qrr_h($localBin ?: 'Unassigned').'</p>';
if($localBin!==$item['bin']) print '<p class="qrr-small"><b>Full Binloc location:</b> '.qrr_h($item['bin']).'</p>';
print '<p><b>Status:</b> '.qrr_h($status).'</p><p><b>Quantity:</b> '.($item['type']==='box' && $item['qty']===null ? 'Unknown (count required)' : (int)qrr_qty($item)).'</p>';
if($item['type']==='tracked'){print '<p><b>Serial / equipment ID:</b> '.qrr_h($item['serial']).'</p><p><b>Details:</b> '.nl2br(qrr_h($item['details'])).'</p>';if(!empty($item['native_batch']))print '<p><b>Native Dolibarr lot/serial:</b> '.qrr_h($item['native_batch']).'</p>';}
$loan=qrr_loan_data($item);$pending=qrr_handoff_data($item);$operation=$item['pending_operation']??null;$status=qrr_item_status($item);
if ($item['type']==='unassigned') print '<div class="qrr-alert">Unassigned label: scan and select a QR type, product, and Binloc location when ready.</div>';
if ($status==='consumed')print '<div class="qrr-alert"><b>Consumed</b> &mdash; not available in warehouse stock.</div>';
if ($operation)print '<div class="qrr-alert"><b>Native inventory operation pending</b> &mdash; stock history must be reconciled before further changes.</div>';
if ($loan) {
    $names=qrr_personal_users($db);$who=$names[(int)$loan['user_id']] ?? ('User #'.(int)$loan['user_id']);
    print '<div class="qrr-alert"><b>Checked out to '.qrr_h($who).'</b><p>Purpose: '.qrr_h($loan['reason'] ?? '').' &middot; since '.qrr_h($loan['at'] ?? '').'</p></div>';
}
if ($pending) print '<div class="qrr-alert"><b>Warehouse transfer pending</b>. Complete and confirm the Dolibarr transfer before changing this record.</div>';
print '<div class="qrr-flex qrr-noprint">';
if(qrr_write_right($user) && $item['type']!=='unassigned' && $status!=='consumed' && !$operation)print '<a class="qrr-btn" href="'.qrr_h(qrr_link('checkout.php',array('code'=>$code))).'">'.($pending?'Continue warehouse transfer':($loan?'Check in / return':'Check out to employee')).'</a>';
if(qrr_write_right($user)&&$status==='consumed'&&!$operation)print '<a class="qrr-btn" href="'.qrr_h(qrr_link('return.php',array('code'=>$code))).'">Return consumed item</a>';
if(qrr_write_right($user)&&$operation)print '<a class="qrr-btn" href="'.qrr_h(qrr_link('reconcile.php',array('code'=>$code))).'">Reconcile pending operation</a>';
if(qrr_write_right($user)&&qrr_available($item)){
    print '<a class="qrr-btn" href="'.qrr_h(qrr_link('workflow.php',array('action'=>'move','code'=>$code))).'">Move this item</a>';
    print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('workflow.php',array('action'=>'consume','code'=>$code))).'">Consume this item</a>';
}

if(qrr_write_right($user)&&!$operation&&$status!=='consumed') print '<a class="qrr-btn" href="'.qrr_h(qrr_link('manage.php',array('code'=>$code))).'">'.($item['type']==='unassigned'?'Assign this QR label':'Edit item metadata').'</a>';
if($item['type']==='box'&&qrr_write_right($user)&&$status==='in_stock'&&!$pending&&!$loan&&!$operation)print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('correction.php',array('code'=>$code))).'">Stock correction</a>';
if(qrr_write_right($user)&&(int)($item['consumed_units']??0)>0&&!$operation&&!$loan)print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('return.php',array('code'=>$code))).'">Return consumed units</a>';
print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('label.php',array('code'=>$code))).'">Print QR label</a>';
if($item['type']==='box' && qrr_write_right($user)&&$status==='in_stock'&&!$loan&&!$pending&&!$operation) print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('camera.php',array('mode'=>'boxdest','from'=>$code))).'">Transfer units — scan destination container</a>';
if($p) print '<a class="qrr-btn alt" href="'.qrr_h(qrr_url_product($item['product_id'])).'">Native product card</a>';
if(qrr_write_right($user)) print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('bulk.php',array('copy'=>$code))).'">Copy / bulk create</a>';
if($item['warehouse_id'] && $item['bin']) print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('bin_print.php',array('warehouse_id'=>$item['warehouse_id'],'bin'=>$item['bin']))).'">Print bin contents</a>';
print '</div></div>';qrr_layout_end();
