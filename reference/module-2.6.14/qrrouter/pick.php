<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Dolibarr main.inc.php missing');
require_once __DIR__.'/lib/qrrouter.lib.php';
if(!qrr_read_right($user)||!qrr_products_right($user)||!qrr_orders_right($user))accessforbidden();
$warehouses=qrr_warehouses($db);$wid=(int)GETPOST('warehouse_id','int');$oid=(int)GETPOST('order_id','int');
$error='';$picks=array();$order=null;$lines=array();$stock=array();
if($oid && isset($warehouses[$wid])){
    try {
        $record=qrr_order_lines($db,$oid);$order=$record['order'];$lines=$record['lines'];
        $state=qrr_load_state();$pids=array_column($lines,'product_id');
        $products=qrr_products_index($db,$pids);
        $picks=qrr_pick_proposal($lines,$state['items'],$wid,$products);
        $totals=qrr_stock_totals($db,$pids);
        $stock=qrr_warehouse_summary($state['items'],$wid);
    }catch(Throwable $e){$error=$e->getMessage();}
}
qrr_layout_start('QR-aware picking sheet');
$orderLabel=$order ? (string)$order->ref : '';
print '<form class="qrr-panel qrr-grid qrr-noprint" id="qrr-pick-form" method="get"><div><label for="qrr-order-search">Customer order (browse or filter)</label><input class="qrr-input" id="qrr-order-search" type="search" autocomplete="off" aria-controls="qrr-order-results" placeholder="Search by order reference or customer" value="'.qrr_h($orderLabel).'"><input type="hidden" name="order_id" id="qrr-order-id" value="'.($oid?:'').'"><div class="qrr-lookup-results" id="qrr-order-results" role="listbox" aria-label="Matching customer orders" hidden></div><p id="qrr-order-status" class="qrr-small">Focus the search field to browse recent orders.</p></div>';
print '<div><label for="qrr-warehouse">Warehouse</label>'.str_replace('name="warehouse_id"','name="warehouse_id" id="qrr-warehouse"',qrr_warehouse_select($warehouses,$wid)).'</div><div style="align-self:end"><button class="qrr-btn">Generate preview</button></div></form>';
print '<script src="'.qrr_h(qrr_base().'assets/order.js?v=2.6.14').'" defer data-order-url="'.qrr_h(qrr_link('order_lookup.php')).'"></script>';
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($order){
    print '<div class="qrr-noprint"><button class="qrr-btn" onclick="window.print()">Print / Save as PDF</button></div>';
    print '<div class="qrr-panel"><h2>QR pick sheet &mdash; '.qrr_h($order->ref).'</h2><p>Warehouse: '.qrr_h($warehouses[$wid]['ref']).' &nbsp; Generated: '.qrr_h(gmdate('Y-m-d H:i').' UTC').'</p>';
    print '<div class="qrr-alert"><b>Planning preview:</b> uses requested order quantities, NOT unshipped balance. It does not reserve, pick, or decrement stock. Verify shipped quantities and any Binloc-only stock before picking.</div>';
    print '<table class="qrr-table"><thead><tr><th>Picked</th><th>Bin</th><th>Product</th><th>Item / QR (individual or box)</th><th>Qty</th></tr></thead><tbody>';
    foreach($picks as $r){
        print '<tr><td>[&nbsp;&nbsp;]</td><td><strong>'.qrr_h($r['bin']).'</strong></td><td>'.qrr_h($r['product']['ref'].' '.$r['product']['label']).'</td><td>'.($r['code']!==''?qrr_item_identity_html(array('code'=>$r['code'],'label'=>$r['label'])):'Not allocated').'</td><td>'.qrr_h($r['take']).'</td></tr>';
    }
    if(!$picks)print '<tr><td colspan="5">No product lines to allocate.</td></tr>';
    print '</tbody></table><h3>Reconciliation checks</h3><table class="qrr-table"><tr><th>Product</th><th>QR-managed</th><th>Native stock</th><th>Status</th></tr>';
    foreach($lines as $line){
        $pid=$line['product_id'];$q=$stock[$pid] ?? array('known'=>0,'unknown'=>0);$real=$totals[$pid][$wid] ?? 0;
        $good=(float)$q['known']===(float)$real && $q['unknown']===0;
        print '<tr><td>'.qrr_h($line['ref'] ?: '#'.$pid).'</td><td>'.$q['known'].($q['unknown']?' + unknown':'').'</td><td>'.qrr_h($real).'</td><td>'.($good?'Matches':'Review').'</td></tr>';
    }
    print '</table></div>';
}
qrr_layout_end();
