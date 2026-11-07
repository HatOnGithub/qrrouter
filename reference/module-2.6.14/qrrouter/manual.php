<?php
/** Handheld/manual QR input for individual and bulk registration/stock operations. */
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';
if(!qrr_read_right($user))accessforbidden();
$intent=(string)GETPOST('intent','alphanohtml');
$mode=(string)GETPOST('mode','alphanohtml');
$action=(string)GETPOST('action','alphanohtml');
$from=qrr_input_code(GETPOST('from','alphanohtml'));
$copy=qrr_input_code(GETPOST('copy','alphanohtml'));
$error='';$step='input';$codes=array();$selected=array();$handoff=null;
$tasks=array('view'=>'Inspect identifiers','register_unique'=>'Register Tracked Individual','register_generic'=>'Register Tracked Generic','register_box'=>'Register Counted Container','move'=>'Move items','checkout'=>'Check out items','checkin'=>'Check in items','consume'=>'Consume items');
$preferred='view';
if($intent==='register'&&in_array($mode,array('unique','generic','box'),true))$preferred='register_'.$mode;
elseif($intent==='workflow'&&in_array($action,array('move','checkout','checkin','consume'),true))$preferred=$action;
$task=(string)($_POST['task']??$preferred);
$cameraReturn=qrr_manual_camera_return($intent,$mode,$action,$from,$copy);
try {
  if($_SERVER['REQUEST_METHOD']==='POST') {
    qrr_check_post();
    $step=(string)($_POST['step']??'input');
    if(!in_array($step,array('review','continue'),true))throw new RuntimeException('Unknown manual entry step');
    if($step==='review') {
      $raw=trim((string)($_POST['code']??''));
      $raw.="\n".(string)($_POST['codes']??'');
      $codes=qrr_workflow_codes($raw);
      if(!$codes)throw new RuntimeException('Enter at least one QR identifier');
    } else {
      $codes=qrr_workflow_codes($_POST['selected']??array());
      if(!$codes){$codes=qrr_workflow_codes((string)($_POST['all_codes']??''));throw new RuntimeException('Select at least one identifier');}
      if(!isset($tasks[$task]))throw new RuntimeException('Select a valid action');
      $state=qrr_load_state();
      foreach($codes as $code)if(!isset($state['items'][$code]))throw new RuntimeException('QR identifier not found: '.$code);
      if($intent==='boxdest') {
        if(count($codes)!==1 || !qrr_code_valid($from))throw new RuntimeException('Select exactly one destination QR');
        header('Location: '.qrr_link('transfer.php',array('from'=>$from,'to'=>$codes[0])));exit;
      }
      if($task==='view') {
        if(count($codes)!==1)throw new RuntimeException('Select one code to inspect, or choose a bulk operation');
        header('Location: '.qrr_link('scan.php',array('code'=>$codes[0])));exit;
      }
      if(!qrr_write_right($user)||!qrr_products_right($user))throw new RuntimeException('Inventory management permission required');
      if(str_starts_with($task,'register_')) {
        $kind=substr($task,9);
        if($kind!=='generic'&&count($codes)!==1)throw new RuntimeException('Select exactly one code in this registration mode');
        $handoff=array('url'=>qrr_link('register.php'),'fields'=>array('mode'=>$kind,'step'=>'details','codes'=>implode("\n",$codes),'copy'=>$copy));
      } else {
        $handoff=array('url'=>qrr_link('workflow.php'),'fields'=>array('action'=>$task,'step'=>'review','codes'=>implode("\n",$codes)));
      }
      $step='handoff';
    }
  }
}catch(Throwable $e){$error=$e->getMessage();$step=($step==='continue'?'review':'input');}
qrr_layout_start('Enter QR codes manually');
print '<p class="qrr-small">Current action: <strong>'.qrr_h($cameraReturn['context']).'</strong></p>';
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($step==='handoff' && $handoff){
  print '<div class="qrr-panel"><h3>Continue with '.count($codes).' selected IDs</h3><p>Taking the selected QR identifiers to the chosen operation. No inventory has been changed.</p>';
  print '<form id="qrr-manual-handoff" method="post" action="'.qrr_h($handoff['url']).'">'.qrr_form_token();
  foreach($handoff['fields'] as $key=>$value)print '<input type="hidden" name="'.qrr_h($key).'" value="'.qrr_h($value).'">';
  print '<button class="qrr-btn">Continue</button></form></div><script>document.getElementById("qrr-manual-handoff").requestSubmit();</script>';
}elseif($step==='review'){
  $state=qrr_load_state();$warehouses=qrr_warehouses($db);$products=qrr_products_index($db,array_column($state['items'],'product_id'));
  print '<div class="qrr-panel"><h3>Review entered IDs</h3><p>Check the identifiers and uncheck any rows you want to exclude.</p>';
  print '<form method="post">'.qrr_form_token().'<input type="hidden" name="step" value="continue"><input type="hidden" name="intent" value="'.qrr_h($intent).'"><input type="hidden" name="mode" value="'.qrr_h($mode).'"><input type="hidden" name="action" value="'.qrr_h($action).'"><input type="hidden" name="copy" value="'.qrr_h($copy).'"><input type="hidden" name="from" value="'.qrr_h($from).'">';
  print '<input type="hidden" name="all_codes" value="'.qrr_h(implode("\n",$codes)).'">';
  print qrr_scan_review_table($codes,$state,$warehouses,$products,true);
  if($intent!=='boxdest')print '<div class="qrr-manual-task"><label for="qrr-manual-task">Action for selected IDs</label><select id="qrr-manual-task" class="qrr-input" name="task">';
  if($intent!=='boxdest'){foreach($tasks as $key=>$label)if($key==='view'||(qrr_write_right($user)&&qrr_products_right($user)))print '<option value="'.qrr_h($key).'"'.($task===$key?' selected':'').'>'.qrr_h($label).'</option>';print '</select></div>';}
  print '<p class="qrr-review-error" role="alert"></p><p class="qrr-flex"><button class="qrr-btn">Continue with selected</button><a class="qrr-btn alt" href="'.qrr_h(qrr_link('manual.php',array('intent'=>$intent,'mode'=>$mode,'action'=>$action,'from'=>$from,'copy'=>$copy))).'">Enter again</a><a class="qrr-btn alt" href="'.qrr_h($cameraReturn['url']).'">'.qrr_h($cameraReturn['label']).'</a></p></form></div>';
  print '<script src="'.qrr_h(qrr_base().'assets/review.js?v=2.6.14').'" defer></script>';
}else{
  print '<div class="qrr-panel"><p>Type or paste QR identifiers. Individual and bulk entry use the same review step before any changes are made.</p>';
  print '<div class="qrr-manual-entry">';
  print '<form class="qrr-panel" method="post">'.qrr_form_token().'<input type="hidden" name="step" value="review"><input type="hidden" name="intent" value="'.qrr_h($intent).'"><input type="hidden" name="mode" value="'.qrr_h($mode).'"><input type="hidden" name="action" value="'.qrr_h($action).'"><input type="hidden" name="copy" value="'.qrr_h($copy).'"><input type="hidden" name="from" value="'.qrr_h($from).'">';
  print '<h3>Single QR</h3><label for="qrr-one-code">QR identifier</label><input class="qrr-input" name="code" id="qrr-one-code" autocomplete="off" maxlength="52" placeholder="Type or scan a code" required><p><button class="qrr-btn">Review code</button></p></form>';
  print '<form class="qrr-panel" method="post">'.qrr_form_token().'<input type="hidden" name="step" value="review"><input type="hidden" name="intent" value="'.qrr_h($intent).'"><input type="hidden" name="mode" value="'.qrr_h($mode).'"><input type="hidden" name="action" value="'.qrr_h($action).'"><input type="hidden" name="copy" value="'.qrr_h($copy).'"><input type="hidden" name="from" value="'.qrr_h($from).'">';
  print '<h3>Multiple QR codes</h3><label for="qrr-many-codes">QR IDs, one per line (or separated by commas)</label><textarea class="qrr-input" name="codes" id="qrr-many-codes" rows="6" placeholder="Paste multiple QR codes" required></textarea><p><button class="qrr-btn">Review codes</button></p></form></div>';
  print '<p><a class="qrr-btn alt" href="'.qrr_h($cameraReturn['url']).'">'.qrr_h($cameraReturn['label']).'</a></p></div>';
}
qrr_layout_end();
