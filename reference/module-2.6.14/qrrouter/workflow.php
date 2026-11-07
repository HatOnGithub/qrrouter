<?php
/** QR Router scan-many actions. Each completed QR movement has its own durable audit record. */
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';
if(!qrr_write_right($user)||!qrr_products_right($user))accessforbidden();
$action=(string)GETPOST('action','alphanohtml');
$actions=array('move'=>'Move items','checkout'=>'Check out items','checkin'=>'Check in items','consume'=>'Consume items');
if(!isset($actions[$action]))accessforbidden('Unknown workflow');
$error='';$results=array();$step='scan';$codes=array();
try {
 $warehouses=qrr_warehouses($db);$state=qrr_load_state();
 $people=($action==='checkout'||$action==='checkin')?qrr_personal_users($db):array();
 // Single-item entry from the QR item card. GET is read-only: stock changes still require POST+CSRF.
 if($_SERVER['REQUEST_METHOD']==='GET' && (string)GETPOST('code','alphanohtml')!==''){
    if(!in_array($action,array('move','consume'),true))throw new RuntimeException('Single-item shortcut only supports Move and Consume');
    $prefill=qrr_input_code(GETPOST('code','alphanohtml'));
    if(!qrr_code_valid($prefill)||!isset($state['items'][$prefill]))throw new RuntimeException('Unknown QR label');
    if(!qrr_available($state['items'][$prefill]))throw new RuntimeException('This item cannot currently be moved or consumed');
    $codes=array($prefill);
    $step='review';
 }
 if($_SERVER['REQUEST_METHOD']==='POST'){
    qrr_check_post();
    $step=(string)($_POST['step']??'scan');
    if(!in_array($step,array('review','perform'),true))throw new RuntimeException('Invalid workflow step');
    $codes=qrr_workflow_codes($step==='perform'?($_POST['selected']??array()):($_POST['selected']??($_POST['codes']??'')));
    if(!$codes)throw new RuntimeException('Scan at least one QR label');
    if($step==='perform')foreach($codes as $code)if(!isset($state['items'][$code]))throw new RuntimeException('Unknown QR label '.$code);
    if($step==='perform'){
       if(!qrr_stock_write_right($user)&&in_array($action,array('checkout','checkin'),true))throw new RuntimeException('Native stock permissions required');
       $person=(int)($_POST['person_id']??0);
       $reason=trim(strip_tags((string)($_POST['reason']??'')));
       if(strlen($reason)>200)throw new RuntimeException('Reason exceeds 200 characters');
       $target=(int)($_POST['warehouse_id']??0);
       $choice=array('bin'=>'','bin_key'=>'','bin_values'=>array());
       if($action==='move'){
         if(!$target||!isset($warehouses[$target]))throw new RuntimeException('Select the destination warehouse');
         $choice=qrr_binloc_choice($db,$target,$_POST['qrr_levels']??array());
       }
       if($action==='checkout'){
         if(!isset($people[$person]))throw new RuntimeException('Select an employee');
         $assigned=array();foreach($codes as $code)if(empty($state['items'][$code]['checkout']))$assigned[]=$code;
         if(!$assigned)throw new RuntimeException('Nothing selected for checkout');
         qrr_ensure_personal_warehouse($db,$user,$person,$people);
         $warehouses=qrr_warehouses($db);
       }
       $referenceType=(string)($_POST['reference_type']??'');$referenceId=(int)($_POST['reference_id']??0);
       if($action==='consume' && $referenceType!=='')qrr_check_reference($db,$user,$referenceType,$referenceId);
       $quantities=is_array($_POST['quantities']??null)?$_POST['quantities']:array();
       $stockMode=(string)($_POST['stock_mode']??'native');
       if($action==='consume'&&!in_array($stockMode,array('native','already_posted'),true))throw new RuntimeException('Invalid stock handling');
       foreach($codes as $code){
         try{
           // Re-read per item; earlier items in this batch may have changed available stock.
           $item=qrr_load_state()['items'][$code];
           if($action==='move') {
             $op=qrr_run_inventory_action($db,$user,$code,'move',array('warehouse_id'=>$target,'choice'=>$choice,'reason'=>$reason),$warehouses);
           }elseif($action==='checkout'||$action==='checkin') {
             $kind=$action;
             $borrower=$action==='checkin'?(int)($item['checkout']['user_id']??0):$person;
             $pending=qrr_stage_handoff($db,$user,$code,$kind,$borrower,$reason,$warehouses,$people);
             try {qrr_do_native_transfer($db,$user,$item,$pending);}
             catch(Throwable $e){throw new RuntimeException($e->getMessage().' Pending handoff retained; reconcile before retrying.');}
             qrr_finish_handoff($db,$user,$code,$pending);
           }else{
             $qty=($item['type']??'')==='box'?($item['qty']??null):1;
             $amount=($item['type']??'')==='box'?filter_var($quantities[$code]??null,FILTER_VALIDATE_INT):1;
             if($amount===false||$amount===null)throw new RuntimeException('Enter a valid quantity');
             qrr_run_inventory_action($db,$user,$code,'consume',array('quantity'=>$amount,'reason'=>$reason,'reference_type'=>$referenceType,'reference_id'=>$referenceId,'post_stock'=>$stockMode==='native'),$warehouses);
           }
           $results[$code]=array('ok'=>true,'message'=>'Completed');
         }catch(Throwable $e){$results[$code]=array('ok'=>false,'message'=>$e->getMessage());}
       }
       $step='result';
    }
 }
}catch(Throwable $e){$error=$e->getMessage();if($step==='perform')$step='scan';}
qrr_layout_start($actions[$action]);
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($step==='result'){
  $state=qrr_load_state();
  $okCount=count(array_filter($results,function($x){return $x['ok'];}));
  print '<div class="qrr-panel"><h3>'.(int)$okCount.' of '.count($results).' completed</h3><p>Each item is saved individually. Failed operations do not undo previously completed items.</p><table class="qrr-table"><thead><tr><th>Item / QR</th><th>Result</th></tr></thead><tbody>';
  foreach($results as $code=>$r)print '<tr><td>'.qrr_item_identity_html($state['items'][$code]??array('code'=>$code)).'</td><td>'.($r['ok']?'Completed':'FAILED: '.qrr_h($r['message'])).'</td></tr>';
  print '</tbody></table><p><a class="qrr-btn" href="'.qrr_h(qrr_link('workflow.php',array('action'=>$action))).'">Start another round</a></p></div>';
}elseif($step==='review' && !$error){
  $products=qrr_products_index($db,array_column($state['items'],'product_id'));
  print '<form method="post" class="qrr-panel" id="qrr-manage">'.qrr_form_token().'<input type="hidden" name="action" value="'.qrr_h($action).'"><input type="hidden" name="step" value="perform">';
  print '<h3>Review scanned items</h3><p class="qrr-small">Uncheck items to leave them out. Each code is scanned only once; no stock changes have occurred.</p>';
  print qrr_scan_review_table($codes,$state,$warehouses,$products,true,$action);
  print '<p class="qrr-review-error" role="alert"></p>';
  if($action==='move'){
    print '<h3>Move all selected items to</h3><div class="qrr-grid"><div><label>Destination Dolibarr warehouse</label>'.str_replace('name="warehouse_id"','name="warehouse_id" id="qrr-warehouse"',qrr_warehouse_select($warehouses,0)).'</div></div>';
    print '<h4>Destination Binloc levels</h4><div id="qrr-levels"><p>Choose a warehouse first.</p></div>';
    print '<p class="qrr-small">Moving between native warehouses transfers the whole tracked item/box quantity in Dolibarr. Within one warehouse only QR bin metadata changes. Split partial containers before moving.</p>';
  }
  if($action==='checkout'){
    print '<label>Employee</label><select class="qrr-input" name="person_id" required><option value="">Select employee</option>';
    foreach($people as $uid=>$name)print '<option value="'.(int)$uid.'">'.qrr_h($name).'</option>';
    print '</select><p class="qrr-small">The selected employee personal warehouse is reused or created, if permissions allow.</p>';
  }
  if($action==='checkin')print '<p class="qrr-small">Each item returns to its stored original warehouse and Binloc position.</p>';
  if($action==='consume'){
    print '<div class="qrr-grid"><div><label for="qrr-reference-type">Linked business transaction</label><select name="reference_type" id="qrr-reference-type" class="qrr-input"><option value="">Other / general consumption</option><option value="shipment">Shipment</option><option value="production">Production / manufacturing order (MRP)</option><option value="salesorder">Customer / sales order</option></select></div><div><label for="qrr-reference-query">Find the transaction</label><input id="qrr-reference-query" class="qrr-input" type="search" placeholder="Select type, then search or browse recent orders" autocomplete="off" aria-controls="qrr-reference-results"><input type="hidden" id="qrr-reference-id" name="reference_id" value="0"><div class="qrr-lookup-results" id="qrr-reference-results" role="listbox" aria-label="Matching business transactions" hidden></div><p id="qrr-reference-status" class="qrr-small">Select a transaction type to browse recent records.</p></div></div>';
    print '<div class="qrr-panel"><strong>Dolibarr stock adjustment</strong><p>For shipments and completed production orders, Dolibarr may have already deducted these units. Do not deduct twice.</p>';
    print '<label><input type="radio" name="stock_mode" value="native" checked> Deduct native Dolibarr warehouse stock now</label><p><label><input type="radio" name="stock_mode" value="already_posted"> Already deducted by Dolibarr (QR registry only)</label></p></div>';
  }
  print '<p><label>Reason / notes (optional)</label><input class="qrr-input" name="reason" maxlength="200" placeholder="Purpose or explanation"></p><p><button class="qrr-btn">Confirm '.qrr_h(strtolower($actions[$action])).'</button> <a class="qrr-btn alt" href="'.qrr_h(qrr_link('workflow.php',array('action'=>$action))).'">Start over</a></p></form>';
  print '<script src="'.qrr_h(qrr_base().'assets/review.js?v=2.6.14').'" defer></script>';
  if($action==='move')print '<script src="'.qrr_h(qrr_base().'assets/form.js?v=2.6.14').'" defer data-product-url="'.qrr_h(qrr_link('product_lookup.php')).'" data-level-url="'.qrr_h(qrr_link('levels.php')).'"></script>';
  if($action==='consume')print '<script src="'.qrr_h(qrr_base().'assets/references.js?v=2.6.14').'" defer data-url="'.qrr_h(qrr_link('reference_lookup.php')).'"></script>';
}else{
  print '<div class="qrr-panel"><p>Point the camera at QR labels. When finished, review the detected IDs and select which ones to process.</p>';
  print '<form method="post" id="qrr-bulk-selection" data-auto-camera="1">'.qrr_form_token().'<input type="hidden" name="action" value="'.qrr_h($action).'"><input type="hidden" name="step" value="review">';
  print '<div class="qrr-camera-stage" id="qrr-camera-stage"><video id="qrr-camera-video" autoplay playsinline muted></video><div class="qrr-camera-placeholder" id="qrr-camera-placeholder">Opening camera…</div></div>';
  print '<div class="qrr-camera-controls"><button type="button" class="qrr-btn alt" id="qrr-camera-toggle">Restart camera</button><a class="qrr-btn alt" href="'.qrr_h(qrr_link('manual.php',array('intent'=>'workflow','action'=>$action))).'">Enter codes manually</a></div>';
  print '<p id="qrr-scan-status" class="qrr-small" role="status"></p><div id="qrr-selected-scans"></div>';
  print '<input type="hidden" id="qrr-scanned-codes" name="codes" value="'.qrr_h(implode("\n",$codes)).'">';
  if(is_file(__DIR__.'/assets/vendor/jsQR.js')) print '<script>window.QRR_JSQR_URL='.json_encode(qrr_base().'assets/vendor/jsQR.js',JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';</script>';
  print '<p><button class="qrr-btn">Finish scanning — review items</button></p></form></div><script src="'.qrr_h(qrr_base().'assets/camera-decoder.js?v=2.6.14').'" defer></script><script src="'.qrr_h(qrr_base().'assets/code.js?v=2.6.14').'" defer></script><script src="'.qrr_h(qrr_base().'assets/scanner.js?v=2.6.14').'" defer></script>';
}
qrr_layout_end();
