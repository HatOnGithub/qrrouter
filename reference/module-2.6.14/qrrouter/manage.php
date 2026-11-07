<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user)||!qrr_products_right($user))accessforbidden();
$error='';$code=qrr_input_code(GETPOST('code','alphanohtml'));$copy=qrr_input_code(GETPOST('copy','alphanohtml'));
try {
    $warehouses=qrr_warehouses($db);$state=qrr_load_state();
    $existing=$state['items'][$code]??null;
    if($code!==''&&!$existing)throw new RuntimeException('QR identifier not found');
    $template=(!$existing && $copy!=='')?($state['items'][$copy]??null):null;
    if($copy!==''&&!$template&&!$existing)throw new RuntimeException('Copy source does not exist');
    if($_SERVER['REQUEST_METHOD']==='POST') {
        qrr_check_post();$action=(string)($_POST['action']??'');
        if(!in_array($action,array('create','update'),true))throw new RuntimeException('Unknown action');
        if($action==='update'&&!$existing)throw new RuntimeException('Unknown QR record');
        $type=($existing && $existing['type']!=='unassigned')?$existing['type']:(string)($_POST['type']??'unassigned');
        $label=trim(strip_tags((string)($_POST['label']??'')));
        $pid=(int)($_POST['product_id']??0);$wid=(int)($_POST['warehouse_id']??0);
        $qtyText=trim((string)($_POST['qty']??''));
        if($type==='box'&&$qtyText!==''&&!preg_match('/^[0-9]{1,9}$/D',$qtyText))throw new RuntimeException('Invalid container quantity');
        $qty=$type==='box'?($qtyText===''?null:(int)$qtyText):($type==='unassigned'?0:1);
        $serial=$type==='tracked'?trim(strip_tags((string)($_POST['serial']??''))):'';
        $details=$type==='tracked'?trim(strip_tags((string)($_POST['details']??''))):'';
        $nativeBatch=$type==='tracked'?trim(strip_tags((string)($_POST['native_batch']??''))):'';
        if(strlen($nativeBatch)>100)throw new RuntimeException('Native lot/serial number too long');
        if($type==='unassigned'){$label='';$pid=0;$wid=0;}
        $choice=qrr_binloc_choice($db,$wid,$_POST['qrr_levels']??array(),$existing,!empty($_POST['qrr_keep_legacy']));
        qrr_item_validate($type,$label,$pid,$wid,$choice['bin'],$qty,$details,$serial,$db,$warehouses,$user);
        if($action==='create') {
            $code=qrr_update(function (&$s) use($type,$label,$pid,$wid,$choice,$qty,$details,$serial,$nativeBatch) {
                $new=qrr_unique_code($s['items']);
                $s['items'][$new]=qrr_make_item($new,$type,$label,$pid,$wid,$choice,$qty,$details,$serial,$nativeBatch);
                return $new;
            },$user,'create');
        } else {
            qrr_update(function (&$s) use($code,$type,$label,$pid,$wid,$choice,$qty,$details,$serial,$nativeBatch) {
                $e =& $s['items'][$code];
                if(!$e)throw new RuntimeException('QR identifier not found');
                if(!empty($e['checkout'])||!empty($e['pending_handoff'])||!empty($e['pending_operation'])||qrr_item_status($e)==='consumed')throw new RuntimeException('Return or reconcile this item before editing');
                if($e['type']==='box' && ($e['qty']??null)!==$qty && $e['type']!=='unassigned')throw new RuntimeException('Use the stock correction workflow to change a container quantity.');
                if($e['type']!=='unassigned' && (int)$e['product_id']!==$pid)throw new RuntimeException('A stocked QR product cannot be changed directly; perform native stock adjustments first.');
                if((int)$e['product_id']>0 && (int)$e['warehouse_id']>0 && (int)$e['warehouse_id']!==$wid)throw new RuntimeException('Use a native warehouse transfer rather than changing an existing stocked item across warehouses');
                $fresh=qrr_make_item($code,$type,$label,$pid,$wid,$choice,$qty,$details,$serial,$nativeBatch);
                $fresh['created_at']=$e['created_at']??gmdate('c');
                // Editing metadata must never reset lifecycle or outstanding consumed units.
                if($e['type']!=='unassigned')unset($fresh['status'],$fresh['consumed_units']);
                $s['items'][$code]=array_merge($e,$fresh);
            },$user,'update',array('code'=>$code,'warehouse_id'=>$wid));
        }
        header('Location: '.qrr_link('scan.php',array('code'=>$code)));exit;
    }
} catch(Throwable $e){$error=$e->getMessage();$warehouses=$warehouses??array();$state=$state??qrr_blank();}
$existing=$state['items'][$code]??null;$editing=(bool)$existing;
$default=$existing??$template??qrr_make_item('','generic');
if(!$editing&&$template){$default['serial']='';$default['native_batch']='';$default['details']='';if($default['type']==='box')$default['qty']=null;}
if($_SERVER['REQUEST_METHOD']==='POST'&&$error){
    foreach(array('type','label','product_id','warehouse_id','qty','serial','details','native_batch') as $key)if(array_key_exists($key,$_POST))$default[$key]=$_POST[$key];
    if(isset($_POST['qrr_levels']))$default['bin_values']=$_POST['qrr_levels'];
}
$type=(string)$default['type'];$wid=(int)($default['warehouse_id']??0);
$product=qrr_product($db,(int)($default['product_id']??0));
qrr_layout_start($editing?'Edit QR item':'Create QR item');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($editing&&(!empty($existing['checkout'])||!empty($existing['pending_handoff'])||!empty($existing['pending_operation'])||qrr_item_status($existing)==='consumed'))print '<div class="qrr-alert">Return or reconcile before editing.</div>';
print '<div class="qrr-panel"><form method="post" id="qrr-manage">'.qrr_form_token().'<input type="hidden" name="action" value="'.($editing?'update':'create').'">';
if($editing)print '<div class="qrr-small">'.qrr_item_identity_html($existing).'</div>';
print '<div class="qrr-grid"><div><label>QR type</label>';
if($editing&&$existing['type']!=='unassigned')print '<strong>'.qrr_h(qrr_types()[$type]).'</strong><input type="hidden" id="qrr-type" name="type" value="'.qrr_h($type).'">';
else {print '<select class="qrr-input" id="qrr-type" name="type">';foreach(qrr_types() as $k=>$txt)print '<option value="'.qrr_h($k).'"'.($type===$k?' selected':'').'>'.qrr_h($txt).'</option>';print '</select>';}
print '</div><div class="qrr-when-assigned"><label>Item name / label</label><input class="qrr-input" name="label" maxlength="140" value="'.qrr_h($default['label']??'').'"></div>';
print '<div class="qrr-when-assigned"><label>Dolibarr product (filterable dropdown)</label><input class="qrr-input" id="qrr-product-search" type="search" placeholder="Filter by reference or name" autocomplete="off" value="'.qrr_h($product?$product->ref.' — '.$product->label:'').'"><input type="hidden" name="product_id" id="qrr-product-id" value="'.(int)($default['product_id']??0).'"><div id="qrr-product-results" class="qrr-lookup-results" role="listbox" aria-label="Matching Dolibarr products" hidden></div><button type="button" class="qrr-btn alt" id="qrr-clear-product">Clear selection</button><p class="qrr-small" id="qrr-product-status"></p></div>';
print '<div class="qrr-when-assigned"><label>Dolibarr warehouse</label>'.str_replace('name="warehouse_id"','name="warehouse_id" id="qrr-warehouse"',qrr_warehouse_select($warehouses,$wid)).'</div></div>';
print '<div class="qrr-when-assigned"><h3>Binloc location levels</h3><div id="qrr-levels">';
try{print qrr_binloc_levels_form($db,$wid,(array)($default['bin_values']??array()),(string)($default['bin']??''),empty($default['bin_values']));}catch(Throwable $e){print '<div class="qrr-alert">'.qrr_h($e->getMessage()).'</div>';}
print '</div></div><div class="qrr-grid">';
print '<div class="qrr-when-box"><label>Container quantity (blank = unknown)</label><input class="qrr-input" type="number" min="0" max="100000000" step="1" name="qty"'.($editing&&$type==='box'?' readonly':'').' value="'.qrr_h($type==='box'&&($default['qty']??null)!==null?$default['qty']:'').'"></div>';
print '<div class="qrr-when-tracked"><label>External serial / DeltaCube ID</label><input class="qrr-input" maxlength="100" name="serial" value="'.qrr_h($default['serial']??'').'"></div>';
print '<div class="qrr-when-tracked"><label>Native Dolibarr lot/serial (existing, if relevant)</label><input class="qrr-input" maxlength="100" name="native_batch" value="'.qrr_h($default['native_batch']??'').'"></div>';
print '<div class="qrr-when-tracked"><label>Tracked-item details</label><textarea class="qrr-input" maxlength="2000" name="details" rows="3">'.qrr_h($default['details']??'').'</textarea></div></div>';
print '<p><button class="qrr-btn">'.($editing?'Save changes':'Create unique QR').'</button></p></form></div>';
if($editing){
    if(qrr_write_right($user)&&qrr_available($existing)){
        print '<p class="qrr-flex"><a class="qrr-btn" href="'.qrr_h(qrr_link('workflow.php',array('action'=>'move','code'=>$code))).'">Move this item</a>';
        print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('workflow.php',array('action'=>'consume','code'=>$code))).'">Consume this item</a></p>';
    }
    if($type==='box')print '<p><a class="qrr-btn" href="'.qrr_h(qrr_link('correction.php',array('code'=>$code))).'">Stock correction: change container quantity</a></p>';print '<p><a class="qrr-btn alt" href="'.qrr_h(qrr_link('bulk.php',array('copy'=>$code))).'">Copy / bulk create from this QR</a></p>';}
print '<script src="'.qrr_h(qrr_base().'assets/form.js?v=2.6.14').'" defer data-product-url="'.qrr_h(qrr_link('product_lookup.php')).'" data-level-url="'.qrr_h(qrr_link('levels.php')).'"></script>';
qrr_layout_end();
