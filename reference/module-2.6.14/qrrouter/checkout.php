<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';
if(!qrr_read_right($user)||!qrr_products_right($user))accessforbidden();
$code=qrr_input_code(GETPOST('code','alphanohtml'));
if(!qrr_code_valid($code))accessforbidden('Invalid identifier');
$error='';$ok='';
try {
    $state=qrr_load_state();$entry=$state['items'][$code]??null;
    if(!$entry)throw new RuntimeException('Unknown identifier');
    $warehouses=qrr_warehouses($db);$people=qrr_personal_users($db);
    $action=(string)($_POST['action']??'');
    if($action!=='') {
        qrr_check_post();
        if(!qrr_stock_write_right($user))throw new RuntimeException('QR manage and Dolibarr stock movement permissions are required');
        if($action==='reconcile') {
            $pending=qrr_handoff_data($entry);
            if(!$pending)throw new RuntimeException('No handoff pending');
            $ok=qrr_reconcile_handoff($db,$user,$code,$pending);
        } elseif($action==='checkout'||$action==='checkin') {
            $person=(int)($_POST['person_id']??0);
            $reason=trim(strip_tags((string)($_POST['reason']??'')));
            if(strlen($reason)>200)throw new RuntimeException('Purpose is too long');
            if($action==='checkout') {
                if(!isset($people[$person]))throw new RuntimeException('Choose an active Dolibarr user');
                if(!empty($entry['checkout'])||!empty($entry['pending_handoff']))throw new RuntimeException('Item already on loan or pending');
                $units=qrr_item_units($entry);
                if(!(int)$entry['product_id']||!(int)$entry['warehouse_id']||qrr_stock_qty($db,(int)$entry['product_id'],(int)$entry['warehouse_id'])<$units)throw new RuntimeException('Insufficient native stock in source warehouse. Personal warehouse was not created.');
                $product=qrr_product($db,(int)$entry['product_id']);
                if(!$product||(int)$product->type!==0)throw new RuntimeException('Link an existing physical product first');
                qrr_native_batch($db,$product,$entry,(int)$entry['warehouse_id'],$units);
                // Resolve or automatically create a warehouse with this employee's name.
                qrr_ensure_personal_warehouse($db,$user,$person,$people);
                $warehouses=qrr_warehouses($db);
            }
            $pending=qrr_stage_handoff($db,$user,$code,$action,$person,$reason,$warehouses,$people);
            try {
                qrr_do_native_transfer($db,$user,$entry,$pending);
            } catch(Throwable $e) {
                // Leave the durable pending marker in place if the transaction outcome is uncertain.
                // Reconciliation examines the unique Dolibarr inventory code before any retry.
                throw new RuntimeException($e->getMessage().' Pending handoff saved; use Reconcile to confirm rollback or completion.');
            }
            qrr_finish_handoff($db,$user,$code,$pending);
            header('Location: '.qrr_link('scan.php',array('code'=>$code,'done'=>$action)));exit;
        } else throw new RuntimeException('Unsupported action');
    }
    $state=qrr_load_state();$entry=$state['items'][$code];
} catch(Throwable $e) {$error=$e->getMessage();}
qrr_layout_start('Check in / Check out');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($ok)print '<div class="qrr-ok">'.qrr_h($ok).'</div>';
if(!isset($entry)){qrr_layout_end();exit;}
$p=qrr_product($db,(int)$entry['product_id']);
$loan=qrr_loan_data($entry);$pending=qrr_handoff_data($entry);
print '<div class="qrr-panel"><h3 class="qrr-item-heading">'.qrr_h(qrr_item_display_name($entry)).'</h3>'.(qrr_item_display_name($entry)!==$code?'<p class="qrr-item-code-muted">QR '.qrr_h($code).'</p>':'');
print '<p>Product: '.($p?qrr_h($p->ref.' — '.$p->label):'Not assigned').'</p>';
print '<p>Current location: '.qrr_h(($warehouses[$entry['warehouse_id']]['ref']??'Unassigned').' / '.$entry['bin']).'</p>';
print '<p>Units transferred: '.($entry['type']==='box'&&$entry['qty']===null?'Unknown':(int)qrr_qty($entry)).'</p>';
if($pending) {
    print '<div class="qrr-alert"><strong>Pending native transfer</strong><p>Reference: '.qrr_h($pending['inventorycode']).'</p><p>Source '.$pending['from'].' → destination '.$pending['to'].', quantity '.$pending['qty'].'.</p><p>Do not repeat checkout. Reconcile the Dolibarr movement records first.</p></div>';
    if(qrr_stock_write_right($user))print '<form method="post">'.qrr_form_token().'<input type="hidden" name="code" value="'.qrr_h($code).'"><input type="hidden" name="action" value="reconcile"><button class="qrr-btn">Reconcile pending transfer</button></form>';
} elseif(!qrr_stock_write_right($user)){
    print '<div class="qrr-alert">You need both QR management and Dolibarr stock movement rights for automatic warehouse transfers.</div>';
} elseif($loan) {
    $uid=(int)$loan['user_id'];
    print '<div class="qrr-alert">Checked out to '.qrr_h($people[$uid]??('Employee #'.$uid)).' — '.qrr_h($loan['reason']??'').'</div>';
    print '<p>Returning to warehouse '.qrr_h($warehouses[(int)$loan['origin_warehouse_id']]['ref']??'#'.(int)$loan['origin_warehouse_id']).', bin '.qrr_h($loan['origin_bin']??'').'.</p>';
    print '<form method="post">'.qrr_form_token().'<input type="hidden" name="action" value="checkin"><input type="hidden" name="code" value="'.qrr_h($code).'"><input type="hidden" name="person_id" value="'.$uid.'"><button class="qrr-btn">Confirm check-in and transfer stock</button></form>';
} else {
    print '<p>Choose the borrower and purpose. When confirmed, Dolibarr moves the full item/container quantity to the employee\'s personal warehouse automatically, creating one with their name if necessary and permitted.</p>';
    print '<form method="post">'.qrr_form_token().'<input type="hidden" name="action" value="checkout"><input type="hidden" name="code" value="'.qrr_h($code).'">';
    print '<p><label>Employee</label><select name="person_id" class="qrr-input" required><option value="">Select employee</option>';
    foreach($people as $uid=>$name){$mapped=(int)($state['personal_warehouses'][$uid]??0);$personal=$mapped?($warehouses[$mapped]['ref']??'Missing mapped warehouse'):qrr_warehouse_person_name($name).' (auto-create if needed)';print '<option value="'.$uid.'"'.($uid===(int)$user->id?' selected':'').'>'.qrr_h($name).' — '.qrr_h($personal).'</option>';}
    print '</select></p><p><label>Reason / test purpose</label><input class="qrr-input" name="reason" maxlength="200" placeholder="e.g. field testing or tool loan"></p>';
    print '<button class="qrr-btn">Confirm checkout and transfer stock</button></form>';
}
print '<p class="qrr-small">This action creates native Dolibarr warehouse transfer movements, not Binloc bin movements. Changing locations inside the same warehouse remains QR-only. A scanned QR never triggers an unconfirmed stock transfer.</p></div>';
qrr_layout_end();
