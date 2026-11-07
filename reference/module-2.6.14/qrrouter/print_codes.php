<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user))accessforbidden();
$error='';try{
 if($_SERVER['REQUEST_METHOD']==='POST'){
  qrr_check_post();$count=filter_var($_POST['count']??null,FILTER_VALIDATE_INT);
  if($count===false||$count<1||$count>200)throw new RuntimeException('Choose between 1 and 200 QR codes');
  $batch=qrr_update(function (&$s)use($count){
   $batchId=strtoupper(bin2hex(random_bytes(6)));while(isset($s['batches'][$batchId]))$batchId=strtoupper(bin2hex(random_bytes(6)));
   $codes=array();for($i=0;$i<$count;$i++){$code=qrr_unique_code($s['items']);$s['items'][$code]=qrr_make_item($code,'unassigned');$codes[]=$code;}
   $s['batches'][$batchId]=array('created_at'=>gmdate('c'),'codes'=>$codes,'type'=>'unassigned');return $batchId;
  },$user,'print_blank_labels',array('count'=>$count));
  header('Location: '.qrr_link('batch_print.php',array('batch'=>$batch)));exit;
 }
}catch(Throwable $e){$error=$e->getMessage();}
qrr_layout_start('Print QR labels');if($error)print '<div class="qrr-alert">'.qrr_h($error).'</div>';
print '<div class="qrr-panel"><p class="qrr-flex"><a class="qrr-btn alt" href="'.qrr_h(qrr_link('batches.php')).'">View unregistered QR batches</a><a class="qrr-btn alt" href="'.qrr_h(qrr_link('register.php',array('start'=>1))).'">Register items</a></p><p>Generate unassigned labels, print them and attach them to equipment or containers. Printing creates no Dolibarr stock.</p>';
print '<form method="post">'.qrr_form_token().'<label>Number of QR codes (1–200)</label><input class="qrr-input" style="max-width:180px" type="number" name="count" value="20" min="1" max="200" required><p><button class="qrr-btn">Create printable batch</button></p></form>';
print '<p><a class="qrr-btn alt" href="'.qrr_h(qrr_link('register.php',array('start'=>1))).'">Go to item registration</a></p></div>';
qrr_layout_end();
