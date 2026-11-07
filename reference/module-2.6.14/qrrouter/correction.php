<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user)||!qrr_products_right($user))accessforbidden();
$code=qrr_input_code(GETPOST('code','alphanohtml'));if(!qrr_code_valid($code))accessforbidden('Invalid QR identifier');
$error='';$success='';try{
  $state=qrr_load_state();$entry=$state['items'][$code]??null;if(!$entry||$entry['type']!=='box')throw new RuntimeException('The identifier must be a quantity container');
  $warehouses=qrr_warehouses($db);
  if($_SERVER['REQUEST_METHOD']==='POST'){
    qrr_check_post();
    if(!qrr_available($entry))throw new RuntimeException('Item unavailable');
    $value=(string)($_POST['new_qty']??'');if(!preg_match('/^(?:0|[1-9][0-9]{0,8})$/D',$value))throw new RuntimeException('Enter a whole number between 0 and 100000000');
    $newQty=(int)$value;$reason=trim(strip_tags((string)($_POST['reason']??'')));
    if(strlen($reason)<3||strlen($reason)>200)throw new RuntimeException('Provide a correction reason (3-200 characters)');
    if($entry['qty']===null){
      qrr_update(function (&$s)use($code,$newQty){$item=&$s['items'][$code];if(($item['qty']??null)!==null||!qrr_available($item))throw new RuntimeException('Container state changed');$item['qty']=$newQty;$item['updated_at']=gmdate('c');},$user,'box_count_established',array('code'=>$code,'new_qty'=>$newQty,'reason'=>$reason,'native_stock_changed'=>false));
      $success='QR count baseline established. Native Dolibarr stock was NOT adjusted. Reconcile the first count against Dolibarr before making later corrections.';
    }else{
      qrr_run_inventory_action($db,$user,$code,'correct',array('quantity'=>$newQty,'reason'=>$reason),$warehouses);
      $success='Stock correction saved; native warehouse quantity adjusted by '.($newQty-(int)$entry['qty']).' unit(s).';
    }
    $entry=qrr_load_state()['items'][$code];
  }
}catch(Throwable $e){$error=$e->getMessage();}
qrr_layout_start('Correct container quantity');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($success)print '<div class="qrr-ok">'.qrr_h($success).'</div>';
if(isset($entry)){
 print '<div class="qrr-panel"><p>'.qrr_item_identity_html($entry).'</p>';
 if(!empty($entry['pending_operation']))print '<p class="qrr-alert">Native stock operation pending. <a href="'.qrr_h(qrr_link('reconcile.php',array('code'=>$code))).'">Reconcile before editing</a>.</p>';
 else{
  print '<p>Current count: <strong>'.($entry['qty']===null?'Unknown':(int)$entry['qty']).'</strong></p>';
  if($entry['qty']===null)print '<div class="qrr-alert">An unknown count has no numeric starting point. Setting its first known value records a QR count baseline only; it cannot safely calculate a native stock delta.</div>';
  else print '<p class="qrr-small">The difference between the old and new counts becomes a native Dolibarr stock movement in this warehouse. This is NOT a container-to-container transfer.</p>';
  print '<form method="post">'.qrr_form_token().'<input type="hidden" name="code" value="'.qrr_h($code).'">';
  print '<label>New quantity</label><input class="qrr-input" type="number" min="0" max="100000000" name="new_qty" value="'.qrr_h($entry['qty']??'').'" required>';
  print '<p><label>Correction reason (required)</label><input class="qrr-input" name="reason" maxlength="200" required placeholder="Count discrepancy, damaged, inventory adjustment"></p><button class="qrr-btn">Confirm stock correction</button></form>';
 }
 print '</div>';
}
qrr_layout_end();
