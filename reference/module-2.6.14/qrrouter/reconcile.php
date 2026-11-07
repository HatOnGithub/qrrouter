<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_stock_write_right($user))accessforbidden();
$code=qrr_input_code(GETPOST('code','alphanohtml'));
if(!qrr_code_valid($code))accessforbidden('Invalid QR identifier');
$message='';$error='';
try{
 $state=qrr_load_state();$entry=$state['items'][$code]??null;if(!$entry)throw new RuntimeException('Unknown item');
 if($_SERVER['REQUEST_METHOD']==='POST'){qrr_check_post();$message=qrr_reconcile_inventory_action($db,$user,$code);$entry=qrr_load_state()['items'][$code];}
}catch(Throwable $e){$error=$e->getMessage();}
qrr_layout_start('Reconcile pending inventory operation');if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';if($message)print '<div class="qrr-ok">'.qrr_h($message).'</div>';
print '<div class="qrr-panel"><p><a href="'.qrr_h(qrr_link('scan.php',array('code'=>$code))).'">Back to '.qrr_h(qrr_item_display_name($entry??array('code'=>$code))).'</a></p>';
if(!empty($entry['pending_operation'])){
 $p=$entry['pending_operation'];print '<p>Operation: '.qrr_h($p['kind']).' &middot; Native inventory code: '.qrr_h($p['id']).'</p>';
 print '<p class="qrr-alert">If the process crashed, verify the movements by this code in Dolibarr stock history. This action will finalize a fully recorded operation or cancel it if there were no movements; partial evidence requires manual investigation.</p>';
 print '<form method="post">'.qrr_form_token().'<input type="hidden" name="code" value="'.qrr_h($code).'"><button class="qrr-btn">Reconcile from Dolibarr movement history</button></form>';
}else print '<p>No pending inventory operation.</p>';
print '</div>';qrr_layout_end();
