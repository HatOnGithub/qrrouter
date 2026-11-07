<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user)||!qrr_products_right($user))accessforbidden();
$code=qrr_input_code(GETPOST('code','alphanohtml'));$error='';$success='';$entry=null;
try {
 $warehouses=qrr_warehouses($db);$state=qrr_load_state();
 if($code!==''){
  if(!qrr_code_valid($code)||!isset($state['items'][$code]))throw new RuntimeException('Unknown QR identifier');
  $entry=$state['items'][$code];
 }
 if($_SERVER['REQUEST_METHOD']==='POST'){
   qrr_check_post();if(!$entry)throw new RuntimeException('Scan an existing QR code');
   $qty=filter_var($_POST['quantity']??null,FILTER_VALIDATE_INT);
   if($qty===false||$qty<1)throw new RuntimeException('Enter a positive return quantity');
   $wid=(int)($_POST['warehouse_id']??0);if(!isset($warehouses[$wid]))throw new RuntimeException('Choose a destination warehouse');
   $choice=qrr_binloc_choice($db,$wid,$_POST['qrr_levels']??array());
   $op=qrr_run_inventory_action($db,$user,$code,'return',array('quantity'=>$qty,'warehouse_id'=>$wid,'choice'=>$choice,'post_stock'=>!empty($_POST['post_stock']),'reason'=>(string)($_POST['reason']??'')),$warehouses);
   $entry=qrr_load_state()['items'][$code];$success='Returned '.(int)$qty.' unit(s). '.($op['effects']?'Native warehouse stock was increased.':'Only the QR registry was updated.');
 }
}catch(Throwable $e){$error=$e->getMessage();}
qrr_layout_start('Return consumed item to inventory');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($success)print '<div class="qrr-ok">'.qrr_h($success).'</div>';
if(!$entry){
 print '<div class="qrr-panel"><form method="get"><label>Previously consumed QR code</label><input class="qrr-input" name="code" autofocus required><p><button class="qrr-btn">Find item</button></p></form></div>';
}else{
 $outstanding=(int)($entry['consumed_units']??0);$available=qrr_item_status($entry)==='consumed'||$outstanding>0;
 print '<div class="qrr-panel"><h3 class="qrr-item-heading">'.qrr_h(qrr_item_display_name($entry)).'</h3>'.(qrr_item_display_name($entry)!==$code?'<p class="qrr-item-code-muted">QR '.qrr_h($code).'</p>':'').'<p>Status: '.qrr_h(qrr_item_status($entry)).' &middot; Unreturned consumed units: '.(int)$outstanding.'</p>';
 if(!empty($entry['pending_operation']))print '<div class="qrr-alert">Stock operation pending. <a href="'.qrr_h(qrr_link('reconcile.php',array('code'=>$code))).'">Reconcile it</a> first.</div>';
 elseif(!$available)print '<div class="qrr-alert">No recorded consumed units are available to return.</div>';
 else{
  $wid=(int)($entry['warehouse_id']??0);
  print '<form method="post" id="qrr-manage">'.qrr_form_token().'<input type="hidden" name="code" value="'.qrr_h($code).'">';
  print '<div class="qrr-grid"><div><label>Return quantity</label><input class="qrr-input" name="quantity" type="number" required min="1" max="'.($outstanding?:1).'" value="'.($outstanding?:1).'"'.($entry['type']!=='box'?' readonly':'').'></div><div><label>Return to warehouse</label>'.str_replace('name="warehouse_id"','name="warehouse_id" id="qrr-warehouse"',qrr_warehouse_select($warehouses,$wid)).'</div></div>';
  print '<h4>Return Binloc location</h4><div id="qrr-levels">';try{print qrr_binloc_levels_form($db,$wid,(array)($entry['bin_values']??array()));}catch(Throwable $e){print '<div class="qrr-alert">'.qrr_h($e->getMessage()).'</div>';}
  print '</div><p><label>Reason or condition</label><input class="qrr-input" name="reason" maxlength="200" placeholder="Returned unused, inspection passed, damaged"></p>';
  print '<p><label><input type="checkbox" name="post_stock" value="1" checked> Add returned quantity to native Dolibarr stock</label></p><p class="qrr-small">Uncheck only if a separate Dolibarr return has already increased stock. Reuses the original QR identity.</p>';
  print '<button class="qrr-btn">Confirm return</button></form>';
  print '<script src="'.qrr_h(qrr_base().'assets/form.js?v=2.6.14').'" defer data-product-url="'.qrr_h(qrr_link('product_lookup.php')).'" data-level-url="'.qrr_h(qrr_link('levels.php')).'"></script>';
 }
 print '</div>';
}
qrr_layout_end();
