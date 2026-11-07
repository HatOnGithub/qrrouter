<?php
/** Six-character QR label compatibility and manual-entry test. */
error_reporting(E_ALL);
define('DOL_DOCUMENT_ROOT', sys_get_temp_dir());
require_once __DIR__.'/../lib/qrrouter.lib.php';
$alphabet='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
assert(strlen($alphabet)===31);
assert(strpos(file_get_contents(__DIR__.'/../qr.php'), "'QRCODE,H'")!==false,'High QR damage correction must remain enabled');
$known=array('23456', 'ZZZZZ', 'AAAAA', '2H7KP');
foreach($known as $payload){
  $code=$payload.qrr_short_check_character($payload);
  assert(strlen($code)===6 && qrr_code_valid($code));
  assert(qrr_workflow_codes(strtolower($code))===array($code));
  for($i=0;$i<6;$i++) {
    foreach(str_split($alphabet) as $replacement) {
      if($replacement===$code[$i])continue;
      $changed=$code; $changed[$i]=$replacement;
      assert(!qrr_code_valid($changed),'Single-symbol edit should fail: '.$code.' => '.$changed);
    }
  }
  for($i=0;$i<4;$i++){
    if($code[$i]===$code[$i+1])continue;
    $changed=$code;[$changed[$i],$changed[$i+1]]=array($changed[$i+1],$changed[$i]);
    assert(!qrr_code_valid($changed),'Adjacent data transposition should fail');
  }
}
assert(!qrr_code_valid('000000'));
assert(!qrr_code_valid('111111'));
assert(!qrr_code_valid('ABCDEF'));
assert(!qrr_code_valid('123'));
assert(qrr_code_valid('ITM-ABCDEF'));
assert(qrr_code_valid('GEN-ABCDEF'));
assert(qrr_code_valid('BOX-ABCDEF'));
assert(qrr_code_valid('QR-ABCDEF'));
assert(qrr_code_valid('ABCDEFGHJK'));
$codes=array();
for($i=0;$i<1000;$i++) {
  $code=qrr_unique_code($codes);
  assert(qrr_code_valid($code) && strlen($code)===6 && !isset($codes[$code]));
  $codes[$code]=true;
}
$one=array_key_first($codes);
assert(qrr_workflow_codes($one."\n".$one)===array($one));
try { qrr_workflow_codes(substr($one,0,5).'0');assert(false); }
catch(RuntimeException $e) { assert(strpos($e->getMessage(),'Invalid QR identifier')!==false); }
echo "Short QR codes: checksum, random generation, typographical errors, and legacy compatibility PASSED.\n";
