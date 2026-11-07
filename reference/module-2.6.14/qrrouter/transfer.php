<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Dolibarr main.inc.php missing');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user))accessforbidden();
$error='';$success='';$from=qrr_input_code(GETPOST('from','alphanohtml'));$to=qrr_input_code(GETPOST('to','alphanohtml'));
try {
    $state=qrr_load_state();
    if($from!==''&&(!qrr_code_valid($from)||!isset($state['items'][$from])||$state['items'][$from]['type']!=='box'))throw new RuntimeException('Source QR must identify a registered quantity box');
    if($to!==''&&(!qrr_code_valid($to)||!isset($state['items'][$to])||$state['items'][$to]['type']!=='box'))throw new RuntimeException('Destination QR must identify a registered quantity box');
    if($to!==''&&$to===$from)throw new RuntimeException('Source and destination must be different boxes');
    if($from!==''&&$to!==''){
        $a=$state['items'][$from];$b=$state['items'][$to];
        if(!empty($a['checkout'])||!empty($b['checkout'])||!empty($a['pending_handoff'])||!empty($b['pending_handoff']))throw new RuntimeException('Cannot transfer contents while either box is on loan or has a pending transfer');
        if(!(int)$a['product_id']||(int)$a['product_id']!==(int)$b['product_id'])throw new RuntimeException('Boxes must contain the same Dolibarr product');
        if(!(int)$a['warehouse_id']||(int)$a['warehouse_id']!==(int)$b['warehouse_id'])throw new RuntimeException('Boxes must belong to the same Dolibarr warehouse');
        if($a['qty']===null||$b['qty']===null)throw new RuntimeException('Both boxes must have a known quantity before transferring');
    }
    if($_SERVER['REQUEST_METHOD']==='POST'){
        qrr_check_post();$amount=(string)($_POST['amount']??'');
        if(!preg_match('/^[1-9][0-9]{0,8}$/D',$amount))throw new RuntimeException('Enter a positive whole-number quantity');
        $n=(int)$amount;
        if($from===''||$to==='')throw new RuntimeException('Scan both boxes first');
        qrr_update(function (&$s) use($from,$to,$n) {
            if(!isset($s['items'][$from],$s['items'][$to]))throw new RuntimeException('Box no longer exists');
            $a=&$s['items'][$from];$b=&$s['items'][$to];
            if($a['type']!=='box'||$b['type']!=='box'||$a['product_id']!=$b['product_id']||!(int)$a['product_id']||$a['warehouse_id']!=$b['warehouse_id']||!(int)$a['warehouse_id'])throw new RuntimeException('Box product or warehouse changed; start again');
            if(!empty($a['checkout'])||!empty($b['checkout'])||!empty($a['pending_handoff'])||!empty($b['pending_handoff']))throw new RuntimeException('Box is on loan or transfer pending');
            if($a['qty']===null||$b['qty']===null||(int)$a['qty']<$n||(int)$b['qty']+$n>100000000)throw new RuntimeException('Invalid or unavailable quantity');
            $a['qty']-=$n;$b['qty']+=$n;$a['updated_at']=$b['updated_at']=gmdate('c');
        },$user,'box_transfer',array('from'=>$from,'to'=>$to,'quantity'=>$n));
        $success=$n.' units transferred between boxes; native warehouse stock unchanged.';$state=qrr_load_state();
    }
}catch(Throwable $e){$error=$e->getMessage();}
qrr_layout_start('Transfer units between boxes');
if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if($success)print '<div class="qrr-ok">'.qrr_h($success).'</div>';
if($from===''||!isset($state['items'][$from]))print '<div class="qrr-panel">Scan a <b>source box</b> first via <a href="'.qrr_h(qrr_link('camera.php')).'">Scan QR</a>.</div>';
elseif($to===''||!isset($state['items'][$to])||$error){
    print '<div class="qrr-panel"><p>Source: '.qrr_item_identity_html($state['items'][$from]).'</p><a class="qrr-btn" href="'.qrr_h(qrr_link('camera.php',array('mode'=>'boxdest','from'=>$from))).'">Scan destination box</a></div>';
}else{
    $a=$state['items'][$from];$b=$state['items'][$to];
    print '<form class="qrr-panel" method="post">'.qrr_form_token().'<h3>Confirm transfer</h3><p>Source '.qrr_item_identity_html($a).' ('.(int)$a['qty'].' units) → destination '.qrr_item_identity_html($b).' ('.(int)$b['qty'].' units)</p>';
    print '<input type="hidden" name="from" value="'.qrr_h($from).'"><input type="hidden" name="to" value="'.qrr_h($to).'"><p><label>Units to transfer<input class="qrr-input" type="number" name="amount" min="1" max="'.(int)$a['qty'].'" required></label></p><button class="qrr-btn">Confirm transfer</button></form>';
    print '<p><a class="qrr-btn alt" href="'.qrr_h(qrr_link('camera.php',array('mode'=>'boxdest','from'=>$from))).'">Scan a different destination</a></p>';
}
print '<p class="qrr-small">Only boxes with the same product and native warehouse. QR counts are updated atomically. No native stock movement is created.</p>';
qrr_layout_end();
