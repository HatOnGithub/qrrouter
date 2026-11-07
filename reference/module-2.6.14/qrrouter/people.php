<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(empty($user->admin))accessforbidden();
$error='';$ok='';
try {
 $warehouses=qrr_warehouses($db);$people=qrr_personal_users($db);
 if($_SERVER['REQUEST_METHOD']==='POST'){
    qrr_check_post();$uid=(int)($_POST['person_id']??0);$wid=(int)($_POST['warehouse_id']??0);
    if(!isset($people[$uid]))throw new RuntimeException('Invalid employee');
    if($wid && !isset($warehouses[$wid]))throw new RuntimeException('Invalid warehouse');
    qrr_update(function (&$state) use ($uid,$wid){
      foreach($state['items'] as $e)if(!empty($e['pending_handoff']))throw new RuntimeException('Resolve pending warehouse transfers before changing personal warehouse mappings');
      foreach($state['items'] as $e)if(!empty($e['checkout'])&&(int)$e['checkout']['user_id']===$uid)throw new RuntimeException('Return all loaned items for this employee before changing the mapping');
      foreach($state['personal_warehouses'] as $other=>$otherWarehouse) if((int)$other!==$uid&&$wid&&(int)$otherWarehouse===$wid)throw new RuntimeException('This warehouse is already assigned to another employee');
      if($wid)$state['personal_warehouses'][$uid]=$wid;else unset($state['personal_warehouses'][$uid]);
    },$user,'personal_warehouse_mapping',array('user_id'=>$uid,'warehouse_id'=>$wid));
    $ok='Personal warehouse mapping saved';
 }
 $state=qrr_load_state();
} catch(Throwable $e){$error=$e->getMessage();$state=$state??qrr_blank();}
qrr_layout_start('Personal warehouses');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($ok)print '<div class="qrr-ok">'.qrr_h($ok).'</div>';
print '<div class="qrr-panel"><p>Optional administrator override: map an employee to an existing Dolibarr warehouse. On checkout without a mapping, QR Router reuses a warehouse whose reference exactly matches the employee name, or creates it through Dolibarr when the operator has Stock > Create warehouse permission. Check-in/out creates native stock movements.</p>';
print '<form method="post">'.qrr_form_token().'<div class="qrr-grid"><div><label>Employee</label><select class="qrr-input" name="person_id" required><option value="">Select</option>';
foreach($people as $uid=>$name)print '<option value="'.$uid.'">'.qrr_h($name).'</option>';print '</select></div><div><label>Personal warehouse</label>'.qrr_warehouse_select($warehouses,0).'</div></div><p><button class="qrr-btn">Save mapping</button></p></form>';
print '<table class="qrr-table"><thead><tr><th>Employee</th><th>Personal warehouse</th></tr></thead><tbody>';
foreach(($state['personal_warehouses']??array()) as $uid=>$wid)print '<tr><td>'.qrr_h($people[(int)$uid]??'Inactive #'.$uid).'</td><td>'.qrr_h($warehouses[(int)$wid]['ref']??'Missing #'.$wid).'</td></tr>';
print '</tbody></table></div>';qrr_layout_end();
