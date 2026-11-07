<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user)||!qrr_products_right($user))accessforbidden();
$error='';$copy=qrr_input_code(GETPOST('copy','alphanohtml'));
try {
 $warehouses=qrr_warehouses($db);$state=qrr_load_state();
 $source=$copy!==''?($state['items'][$copy]??null):null;
 if($copy!==''&&!$source)throw new RuntimeException('Copy source not found');
 if($_SERVER['REQUEST_METHOD']==='POST'){
    qrr_check_post();$mode=(string)($_POST['mode']??'blank');
    $count=(int)($_POST['count']??0);
    if($count<1||$count>200)throw new RuntimeException('Batch size must be between 1 and 200 labels');
    if(!in_array($mode,array('blank','assigned'),true))throw new RuntimeException('Invalid batch mode');
    $type=$mode==='blank'?'unassigned':(string)($_POST['type']??'generic');
    if(!isset(qrr_types()[$type])||($mode==='assigned'&&$type==='unassigned'))throw new RuntimeException('Select an assigned QR type');
    $label=$mode==='blank'?'':trim(strip_tags((string)($_POST['label']??'')));
    $pid=$mode==='blank'?0:(int)($_POST['product_id']??0);$wid=$mode==='blank'?0:(int)($_POST['warehouse_id']??0);
    $qtyText=trim((string)($_POST['qty']??''));
    if($type==='box'&&$qtyText!==''&&!preg_match('/^[0-9]{1,9}$/D',$qtyText))throw new RuntimeException('Invalid quantity');
    $qty=$type==='box'?($qtyText===''?null:(int)$qtyText):($type==='unassigned'?0:1);
    $choice=qrr_binloc_choice($db,$wid,$_POST['qrr_levels']??array());
    qrr_item_validate($type,$label,$pid,$wid,$choice['bin'],$qty,'','',$db,$warehouses,$user);
    $batch=qrr_update(function (&$s) use($count,$type,$label,$pid,$wid,$choice,$qty) {
        $batchId=strtoupper(bin2hex(random_bytes(6)));
        while(isset($s['batches'][$batchId]))$batchId=strtoupper(bin2hex(random_bytes(6)));
        $codes=array();
        for($i=0;$i<$count;$i++){
            $code=qrr_unique_code($s['items']);
            $s['items'][$code]=qrr_make_item($code,$type,$label,$pid,$wid,$choice,$qty);
            $codes[]=$code;
        }
        $s['batches'][$batchId]=array('created_at'=>gmdate('c'),'codes'=>$codes,'type'=>$type);
        return $batchId;
    },$user,'bulk_create',array('count'=>$count,'type'=>$type));
    header('Location: '.qrr_link('batch_print.php',array('batch'=>$batch)));exit;
 }
} catch(Throwable $e){$error=$e->getMessage();$state=$state??qrr_blank();$warehouses=$warehouses??array();}
$source=$state['items'][$copy]??null;
$type=(string)($source['type']??'generic');if($type==='unassigned')$type='generic';
$wid=(int)($source['warehouse_id']??0);$product=qrr_product($db,(int)($source['product_id']??0));
qrr_layout_start('Bulk create / copy QR labels');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
print '<div class="qrr-panel"><p>Generate 1–200 unique short QR identifiers in one operation. Print the batch, then assign blank labels individually when scanned. Or copy type, product, and storage location to all new records.</p>';
print '<form method="post" id="qrr-bulk">'.qrr_form_token().'<div class="qrr-grid"><div><label>Mode</label><select class="qrr-input" name="mode" id="qrr-bulk-mode"><option value="blank"'.(!$source?' selected':'').'>Unassigned labels (print and assign later)</option><option value="assigned"'.($source?' selected':'').'>Create assigned records / copy</option></select></div><div><label>Number of QR labels</label><input class="qrr-input" name="count" type="number" min="1" max="200" value="20" required></div></div>';
print '<div id="qrr-bulk-assigned"'.(!$source?' style="display:none"':'').'><div class="qrr-grid"><div><label>QR type</label><select class="qrr-input" id="qrr-type" name="type">';
foreach(qrr_types() as $k=>$txt)if($k!=='unassigned')print '<option value="'.qrr_h($k).'"'.($type===$k?' selected':'').'>'.qrr_h($txt).'</option>';
print '</select></div><div><label>Item name / label (same on every copy)</label><input class="qrr-input" name="label" value="'.qrr_h($source['label']??'').'" maxlength="140"></div>';
print '<div><label>Dolibarr product (filterable dropdown)</label><input class="qrr-input" id="qrr-product-search" type="search" autocomplete="off" placeholder="Filter by product name or reference" value="'.qrr_h($product?$product->ref.' — '.$product->label:'').'"><input type="hidden" id="qrr-product-id" name="product_id" value="'.(int)($source['product_id']??0).'"><div id="qrr-product-results" class="qrr-lookup-results" role="listbox" aria-label="Matching Dolibarr products" hidden></div><button type="button" id="qrr-clear-product" class="qrr-btn alt">Clear selection</button><p id="qrr-product-status" class="qrr-small"></p></div>';
print '<div><label>Dolibarr warehouse</label>'.str_replace('name="warehouse_id"','name="warehouse_id" id="qrr-warehouse"',qrr_warehouse_select($warehouses,$wid)).'</div></div>';
print '<h3>Binloc location</h3><div id="qrr-levels">';try{print qrr_binloc_levels_form($db,$wid,$source['bin_values']??array());}catch(Throwable $e){print '<div class="qrr-alert">'.qrr_h($e->getMessage()).'</div>';}
print '</div><div class="qrr-grid"><div class="qrr-when-box"><label>Initial count per box (blank = unknown)</label><input class="qrr-input" type="number" name="qty" min="0" max="100000000" value="'.qrr_h($type==='box'&&($source['qty']??null)!==null?$source['qty']:'').'"></div></div>';
print '<p class="qrr-small">Copies never inherit serial numbers, equipment IDs, native lot numbers or individual notes. Each copy receives an independent QR ID.</p></div>';
print '<p><button class="qrr-btn">Create and open printable batch</button></p></form></div>';
print '<h3>Recent batches</h3><table class="qrr-table"><thead><tr><th>Created</th><th>Type</th><th>Count</th><th></th></tr></thead><tbody>';
foreach(array_slice(array_reverse($state['batches']??array(),true),0,15,true) as $bid=>$row)print '<tr><td>'.qrr_h($row['created_at']).'</td><td>'.qrr_h(qrr_types()[$row['type']]??$row['type']).'</td><td>'.count($row['codes']).'</td><td><a href="'.qrr_h(qrr_link('batch_print.php',array('batch'=>$bid))).'">Print again</a></td></tr>';
print '</tbody></table>';
print '<script src="'.qrr_h(qrr_base().'assets/form.js?v=2.6.14').'" defer data-product-url="'.qrr_h(qrr_link('product_lookup.php')).'" data-level-url="'.qrr_h(qrr_link('levels.php')).'"></script>';
print '<script>document.getElementById("qrr-bulk-mode").addEventListener("change",function(){document.getElementById("qrr-bulk-assigned").style.display=this.value==="assigned"?"":"none";});</script>';
qrr_layout_end();
