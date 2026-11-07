<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user)||!qrr_products_right($user))accessforbidden();
$mode=(string)GETPOST('mode','alphanohtml');$modes=array('unique'=>qrr_t('Tracked Individual'),'generic'=>qrr_t('Tracked Generic'),'box'=>qrr_t('Counted Container'));
$error='';$step=(string)GETPOST('step','alphanohtml');$codes=array();$incomingThumb=(string)($_POST['scan_thumbnail']??'');$copy=qrr_input_code(GETPOST('copy','alphanohtml'));$last=qrr_input_code(GETPOST('registered','alphanohtml'));
try{
 if(isset($_GET['start']) || ($_SERVER['REQUEST_METHOD']==='GET' && $mode==='' && $step===''))unset($_SESSION['qrr_round_codes']);
 $warehouses=qrr_warehouses($db);$state=qrr_load_state();
 if($mode!==''&&!isset($modes[$mode]))throw new RuntimeException('Invalid registration mode');
 if($step==='review' || $step==='details'){
   if($_SERVER['REQUEST_METHOD']==='POST')qrr_check_post();
   $codes=qrr_workflow_codes($_POST['selected']??(string)GETPOST('codes','none'));
   if(!$codes)throw new RuntimeException('Scan at least one label');
   if($mode!=='generic'&&count($codes)!==1)throw new RuntimeException('This mode registers one label at a time');
   if($step==='details')foreach($codes as $code)if(!isset($state['items'][$code])||$state['items'][$code]['type']!=='unassigned')throw new RuntimeException('Label is already assigned or missing: '.$code);
 }
 if($_SERVER['REQUEST_METHOD']==='POST' && $step==='save'){
   qrr_check_post();
   $mode=(string)($_POST['mode']??'');if(!isset($modes[$mode]))throw new RuntimeException('Invalid registration mode');
   $codes=qrr_workflow_codes((string)($_POST['codes']??''));
   $type=$mode==='unique'?'tracked':($mode==='generic'?'generic':'box');
   $fields=qrr_registration_fields($db,$user,$_POST,$warehouses,$type);
   $scanBytes=$mode==='unique'?qrr_thumbnail_decode($incomingThumb):null;
   $new=qrr_register_codes($db,$user,$codes,$type,$fields);
   if($scanBytes!==null){
      try{qrr_thumbnail_store($new[0],$scanBytes);}
      catch(Throwable $e){dol_syslog('QR Router: scan thumbnail could not be saved: '.$e->getMessage(),LOG_WARNING);}
   }
   if(!isset($_SESSION['qrr_round_codes'])||!is_array($_SESSION['qrr_round_codes']))$_SESSION['qrr_round_codes']=array();
   $_SESSION['qrr_round_codes']=array_values(array_unique(array_merge($_SESSION['qrr_round_codes'],$new)));
   $next=(string)($_POST['next']??'finish');
   if($next==='copy'&&$mode!=='generic')header('Location: '.qrr_link('register.php',array('mode'=>$mode,'copy'=>$new[0],'registered'=>$new[0])));
   elseif($next==='new'&&$mode!=='generic')header('Location: '.qrr_link('register.php',array('mode'=>$mode,'registered'=>$new[0])));
   else header('Location: '.qrr_link('register_summary.php'));
   exit;
 }
}catch(Throwable $e){$error=$e->getMessage();if($step==='details'||$step==='review')$step='scan';elseif($step==='save' && $codes)$step='details';}
qrr_layout_start('Register new items');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($last!=='' && isset($state['items'][$last]))print '<div class="qrr-ok">Saved '.qrr_h($last).'. Scan the next unassigned label.</div>';
if($mode===''){
  $unregistered=qrr_unassigned_batches($state);
  print '<div class="qrr-panel"><h3>1. Get QR labels</h3><p><strong>'.(int)$unregistered['unassigned_total'].' labels are ready to register.</strong></p><p class="qrr-flex"><a class="qrr-btn" href="'.qrr_h(qrr_link('batches.php')).'">View unregistered QR batches</a><a class="qrr-btn alt" href="'.qrr_h(qrr_link('print_codes.php')).'">Print new QR codes</a></p><h3>2. What do you want to register?</h3><div class="qrr-grid qrr-registration-options">';
  foreach($modes as $m=>$label)print '<div class="qrr-panel qrr-option-card"><h3>'.qrr_h($label).'</h3><p class="qrr-small">'.qrr_h($m==='unique'?'One QR per individual device. Save and continue with copied or empty fields.':($m==='generic'?'Scan all QR identifiers before filling common information once.':'A QR-labelled container holding a known quantity of a single Dolibarr SKU.')).'</p><a class="qrr-btn" href="'.qrr_h(qrr_link('register.php',array('mode'=>$m))).'">Select</a></div>';
  print '</div></div>';
}elseif($step==='review' && !$error){
  $products=qrr_products_index($db,array_column($state['items'],'product_id'));
  print '<form class="qrr-panel" method="post">'.qrr_form_token().'<input type="hidden" name="step" value="details"><input type="hidden" name="mode" value="'.qrr_h($mode).'">';
  if($copy!=='')print '<input type="hidden" name="copy" value="'.qrr_h($copy).'">';
  print '<h3>Review scanned IDs</h3><p class="qrr-small">Select the labels to register. Nothing has been assigned yet.</p>';
  print qrr_scan_review_table($codes,$state,$warehouses,$products,true,'register');
  print '<p class="qrr-review-error" aria-live="polite"></p><p class="qrr-flex"><button class="qrr-btn">Continue with selected labels</button><a class="qrr-btn alt" href="'.qrr_h(qrr_link('register.php',array('mode'=>$mode))).'">Rescan</a></p></form>';
  print '<script src="'.qrr_h(qrr_base().'assets/review.js?v=2.6.14').'" defer></script>';
}elseif($step!=='details'){
  print '<div class="qrr-panel"><h3>'.qrr_h($modes[$mode]).' — Scan labels</h3><p class="qrr-small">'.($mode==='generic'?'Scan all labels, then finish scanning and fill common product/location information.':($mode==='unique'?'Scan one unassigned label. The details form opens automatically after a valid scan.':'Scan one unassigned label, then finish scanning to open its details.')).'</p>';
  print '<p><a href="'.qrr_h(qrr_link('batches.php')).'">Browse existing unregistered QR batches</a> · <a href="'.qrr_h(qrr_link('print_codes.php')).'">Print new labels</a></p>';
  print '<form id="qrr-bulk-selection" method="post" data-auto-camera="1"'.($mode==='unique'?' data-auto-continue="1" novalidate':'').'>'.qrr_form_token();
  print '<input type="hidden" name="mode" value="'.qrr_h($mode).'"><input type="hidden" name="step" value="'.($mode==='unique'?'details':'review').'">';
  if($mode==='unique')print '<input type="hidden" id="qrr-scan-thumbnail" name="scan_thumbnail" value="">';
  if($copy!=='')print '<input type="hidden" name="copy" value="'.qrr_h($copy).'">';
  print '<div class="qrr-camera-stage" id="qrr-camera-stage"><video id="qrr-camera-video" autoplay playsinline muted></video><div class="qrr-camera-placeholder">Opening camera…</div></div>';
  print '<div class="qrr-camera-controls"><button type="button" id="qrr-camera-toggle" class="qrr-btn alt">Restart camera</button><a class="qrr-btn alt" href="'.qrr_h(qrr_link('manual.php',array('intent'=>'register','mode'=>$mode,'copy'=>$copy))).'">Enter codes manually</a></div>';
  print '<p id="qrr-scan-status" class="qrr-small" role="status"></p><div id="qrr-selected-scans"></div>';
  print '<input type="hidden" id="qrr-scanned-codes" name="codes" value="">';
  print '<p><button class="qrr-btn">'.($mode==='unique'?'Continue to details':'Finish scanning — review IDs').'</button></p></form></div>';
  if(is_file(__DIR__.'/assets/vendor/jsQR.js')) print '<script>window.QRR_JSQR_URL='.json_encode(qrr_base().'assets/vendor/jsQR.js',JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';</script>';
print '<script src="'.qrr_h(qrr_base().'assets/camera-decoder.js?v=2.6.14').'" defer></script><script src="'.qrr_h(qrr_base().'assets/code.js?v=2.6.14').'" defer></script><script src="'.qrr_h(qrr_base().'assets/scanner.js?v=2.6.14').'" defer></script>';

}else{
  $template=($copy!==''&&isset($state['items'][$copy]) && ($state['items'][$copy]['type']==='tracked'||$state['items'][$copy]['type']==='box'))?$state['items'][$copy]:array();
  $default=$template;
  if($template){$default['serial']='';$default['native_batch']='';}
  if($_SERVER['REQUEST_METHOD']==='POST' && $error){$default=array_merge($default,$_POST);$default['bin_values']=$_POST['qrr_levels']??array();}
  $wid=(int)($default['warehouse_id']??0);$product=qrr_product($db,(int)($default['product_id']??0));
  print '<div class="qrr-panel"><h3>'.count($codes).' scanned label(s)</h3>';
  if($mode==='unique') {
    $scanned=$codes[0];
    $photo=null;
    try{$photo=qrr_thumbnail_decode($incomingThumb);}catch(Throwable $e){$photo=null;}
    $thumb=$photo!==null?$incomingThumb:qrr_link('qr.php',array('code'=>$scanned));
    print '<div class="qrr-flex" style="margin:0 0 16px"><img class="qrr-scan-thumb" src="'.qrr_h($thumb).'" alt="Scanned QR '.qrr_h($scanned).'" width="112" height="112"><div><strong>Scanned QR '.($photo!==null?'camera snapshot':'label').'</strong><p class="qrr-tag">'.qrr_h($scanned).'</p><span class="qrr-small">'.($photo!==null?'QR snapshot saved with this item when you register.':'Handheld scans show the QR image; camera scans also capture a thumbnail.').'</span></div></div>';
  } else print '<p class="qrr-tag">'.qrr_h(implode(', ',$codes)).'</p>';
  print '<form id="qrr-manage" method="post">'.qrr_form_token().'<input type="hidden" name="step" value="save"><input type="hidden" name="mode" value="'.qrr_h($mode).'"><input type="hidden" name="codes" value="'.qrr_h(implode("\n",$codes)).'">';
  if($mode==='unique'&&$incomingThumb!=='')print '<input type="hidden" name="scan_thumbnail" value="'.qrr_h($incomingThumb).'">';
  print '<div class="qrr-grid"><div><label>Item name / label</label><input class="qrr-input" name="label" maxlength="140" value="'.qrr_h($default['label']??'').'"></div>';
  print '<div><label>Dolibarr product</label><input class="qrr-input" id="qrr-product-search" type="search" placeholder="Search products" autocomplete="off" value="'.qrr_h($product?$product->ref.' — '.$product->label:'').'"><input type="hidden" id="qrr-product-id" name="product_id" value="'.(int)($default['product_id']??0).'"><div id="qrr-product-results" class="qrr-lookup-results" role="listbox" aria-label="Matching Dolibarr products" hidden></div><button type="button" class="qrr-btn alt" id="qrr-clear-product">Clear</button><p class="qrr-small" id="qrr-product-status"></p></div>';
  print '<div><label>Dolibarr warehouse</label>'.str_replace('name="warehouse_id"','name="warehouse_id" id="qrr-warehouse"',qrr_warehouse_select($warehouses,$wid)).'</div></div>';
  print '<h4>Binloc location</h4><div id="qrr-levels">';
  try{print qrr_binloc_levels_form($db,$wid,(array)($default['bin_values']??array()));}catch(Throwable $e){print '<div class="qrr-alert">'.qrr_h($e->getMessage()).'</div>';}
  print '</div><div class="qrr-grid">';
  if($mode==='unique'){
    print '<div><label>External serial / DeltaCube ID</label><input class="qrr-input" name="serial" maxlength="100" value="'.qrr_h($default['serial']??'').'"></div>';
    print '<div><label>Native Dolibarr lot/serial (if applicable)</label><input class="qrr-input" name="native_batch" maxlength="100" value="'.qrr_h($default['native_batch']??'').'"></div>';
    print '<div><label>Details</label><textarea class="qrr-input" name="details" rows="3" maxlength="2000">'.qrr_h($default['details']??'').'</textarea></div>';
  }elseif($mode==='box'){
    print '<div><label>Quantity in container</label><input class="qrr-input" name="qty" type="number" min="0" max="100000000" required value="'.qrr_h($default['qty']??'').'"></div>';
  }
  print '</div><p class="qrr-small">Registration associates QR labels with existing Dolibarr inventory. It does not receive or increment native warehouse stock.</p>';
  print '<div class="qrr-flex"><button class="qrr-btn" name="next" value="finish">Save and Finish</button>';
  if($mode!=='generic')print '<button class="qrr-btn alt" name="next" value="copy">Save and Next (Copy)</button><button class="qrr-btn alt" name="next" value="new">Save and Next (New)</button>';
  print '</div></form></div>';
  print '<script src="'.qrr_h(qrr_base().'assets/form.js?v=2.6.14').'" defer data-product-url="'.qrr_h(qrr_link('product_lookup.php')).'" data-level-url="'.qrr_h(qrr_link('levels.php')).'"></script>';
}
qrr_layout_end();
