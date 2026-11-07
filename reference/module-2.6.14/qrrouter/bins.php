<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Dolibarr main.inc.php missing');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user)||!qrr_products_right($user))accessforbidden();
$state=qrr_load_state();$warehouses=qrr_warehouses($db);
$wid=(int)GETPOST('warehouse_id','int');$wid=isset($warehouses[$wid])?$wid:0;
$bins=$wid ? qrr_known_bins($state['items'],$wid) : array();
qrr_layout_start('Bin content printouts');
print '<div class="qrr-panel"><p><a class="qrr-btn alt" href="'.qrr_h(qrr_link('binloc_labels.php',array('warehouse_id'=>$wid))).'">Configure local Binloc labels</a></p><p>Print a bin-content inventory sheet for an individual bin, or print all occupied QR-managed bins in a warehouse. Individually tracked items appear one by one; generic items and box quantities are summed by product.</p>';
print '<form method="get" class="qrr-flex qrr-noprint">'.qrr_warehouse_select($warehouses,$wid).'<button class="qrr-btn" type="submit">List bins</button></form></div>';
if($wid){
    print '<div class="qrr-flex qrr-noprint"><a class="qrr-btn" href="'.qrr_h(qrr_link('bin_print.php',array('warehouse_id'=>$wid))).'">Print all '.count($bins).' occupied bins</a></div>';
    print '<table class="qrr-table"><thead><tr><th>Binloc code</th><th>Tracked items</th><th>Generic units</th><th>Box units</th><th>Unknown count boxes</th><th>Print</th></tr></thead><tbody>';
    $products=qrr_products_index($db,array_column($state['items'],'product_id'));
    foreach($bins as $bin){
        $sum=qrr_bin_summary($state['items'],$wid,$bin,$products);
        $gen=0;$box=0;$unk=0;foreach($sum['totals'] as $t){$gen+=$t['generic'];$box+=$t['box'];$unk+=$t['unknown_boxes'];}
        $example=null;foreach($state['items'] as $entry){if((int)($entry['warehouse_id']??0)===$wid && ($entry['bin']??'')===$bin){$example=$entry;break;}}
        $local=$example?qrr_binloc_local_label($db,$wid,$example,$state):$bin;
        print '<tr><td><strong>'.qrr_h($local).'</strong>'.($local!==$bin?'<div class="qrr-small">Full: '.qrr_h($bin).'</div>':'').'</td><td>'.count($sum['tracked']).'</td><td>'.$gen.'</td><td>'.$box.'</td><td>'.$unk.'</td>';
        print '<td><a href="'.qrr_h(qrr_link('bin_print.php',array('warehouse_id'=>$wid,'bin'=>$bin))).'">Print contents</a></td></tr>';
    }
    if(!$bins) print '<tr><td colspan="6">No QR-managed inventory assigned to this warehouse yet.</td></tr>';
    print '</tbody></table>';
}
print '<p class="qrr-small">These reports cover QR-managed positions only. Native Binloc assignments not registered with this module are not shown. Binloc itself is not modified.</p>';
qrr_layout_end();
