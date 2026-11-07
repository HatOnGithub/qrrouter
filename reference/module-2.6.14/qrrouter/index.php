<?php
$res = 0;
if (is_file(__DIR__.'/../../main.inc.php')) $res = include __DIR__.'/../../main.inc.php';
if (!$res) die('Dolibarr main.inc.php not found');
require_once __DIR__.'/lib/qrrouter.lib.php';
if (!qrr_read_right($user) || !qrr_products_right($user)) accessforbidden();
try { $state = qrr_load_state(); $warehouses = qrr_warehouses($db); }
catch (Throwable $e) { accessforbidden($e->getMessage()); }
$items = $state['items']; ksort($items, SORT_NATURAL);
$batchSummary=qrr_unassigned_batches($state);
$products = qrr_products_index($db, array_column($items,'product_id'));
$filter = strtoupper(trim((string)GETPOST('search', 'alphanohtml')));
qrr_layout_start('QR inventory');
print '<div class="qrr-panel"><strong>QR Product Router</strong> &mdash; '.count($items).' labels. <a href="'.qrr_h(qrr_link('batches.php')).'"><strong>'.(int)$batchSummary['unassigned_total'].' unregistered QR labels</strong></a> in '.(int)$batchSummary['remaining_batches'].' batches. Binloc positions are QR-managed; movements between native warehouses are posted to Dolibarr stock.</div>';
if(qrr_write_right($user)){
 $tasks=array('Unregistered QR batches'=>'batches.php','Print labels'=>'print_codes.php','Register items'=>'register.php','Move items'=>'workflow.php?action=move','Check out'=>'workflow.php?action=checkout','Check in'=>'workflow.php?action=checkin','Consume'=>'workflow.php?action=consume','Return consumed'=>'return.php','Local Binloc labels'=>'binloc_labels.php');
 print '<div class="qrr-panel qrr-noprint"><strong>Warehouse operations</strong><div class="qrr-flex" style="margin-top:12px">';
 foreach($tasks as $title=>$path)print '<a class="qrr-btn alt" href="'.qrr_h(qrr_base().$path).'">'.qrr_h($title).'</a>';
 print '</div></div>';
}

print '<form method="get" class="qrr-flex qrr-noprint"><input class="qrr-input" style="max-width:300px" name="search" value="'.qrr_h($filter).'" placeholder="QR, bin, product ID or label"><button class="qrr-btn">Search</button></form>';
print '<table class="qrr-table"><thead><tr><th>Item / QR</th><th>Type</th><th>Product</th><th>Bin</th><th>Quantity</th><th>Status</th><th></th></tr></thead><tbody>';
$count = 0;
foreach ($items as $item) {
    $pid = (int)$item['product_id'];
    $p = $products[$pid] ?? array('ref'=>($pid ? '#'.$pid : 'Unassigned'),'label'=>'');
    $w = $warehouses[(int)$item['warehouse_id']] ?? array('ref'=>'', 'label'=>'');
    $localBin=qrr_binloc_local_label($db,(int)$item['warehouse_id'],$item,$state);
    $haystack = strtoupper($item['code'].' '.$item['label'].' '.$item['bin'].' '.$localBin.' '.$p['ref'].' '.$p['label'].' '.$pid);
    if ($filter !== '' && strpos($haystack,$filter) === false) continue;
    $count++;
    print '<tr><td>'.qrr_item_identity_html($item).'</td>';
    print '<td>'.qrr_h(qrr_types()[$item['type']] ?? $item['type']).'</td>';
    print '<td>'.qrr_h($p['ref'].' '.$p['label']).'</td>';
    print '<td>'.qrr_h($w['ref'].' / '.$localBin).($localBin!==$item['bin']?'<div class="qrr-small">Full: '.qrr_h($item['bin']).'</div>':'').'</td>';
    print '<td>'.($item['type']==='box' && $item['qty'] === null ? 'Unknown' : (int)qrr_qty($item)).'</td>';
    $loan=qrr_loan_data($item);$pending=qrr_handoff_data($item);
    print '<td>'.($pending?'Transfer pending':($loan?'Checked out to user #'.(int)$loan['user_id']:(!empty($item['pending_operation'])?'Inventory operation pending':(qrr_item_status($item)==='consumed'?'Consumed':($item['type']==='unassigned'?'Unassigned':'In storage'))))).'</td>';
    print '<td><a href="'.qrr_h(qrr_link('label.php',array('code'=>$item['code']))).'">Print QR</a></td></tr>';
}
if (!$count) print '<tr><td colspan="7">No matching items.</td></tr>';
print '</tbody></table>';
qrr_layout_end();
