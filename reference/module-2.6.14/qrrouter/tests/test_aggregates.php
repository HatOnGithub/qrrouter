<?php
/** Standalone CLI test without a Dolibarr installation. */
error_reporting(E_ALL);
$tmp = sys_get_temp_dir().'/qrr-test-'.bin2hex(random_bytes(4));
@mkdir($tmp,0700,true);
define('DOL_DOCUMENT_ROOT', __DIR__);
define('DOL_DATA_ROOT', $tmp);
$conf = (object) array('entity'=>1);
require_once __DIR__.'/../lib/qrrouter.lib.php';
$rows = array(
    'ITM-AAAAAA'=>array('code'=>'ITM-AAAAAA','type'=>'tracked','warehouse_id'=>1,'bin'=>'A01','product_id'=>5,'qty'=>1,'label'=>'Device 1','serial'=>'DIOT01','details'=>'Firmware'),
    'ITM-BBBBBB'=>array('code'=>'ITM-BBBBBB','type'=>'tracked','warehouse_id'=>1,'bin'=>'A01','product_id'=>5,'qty'=>1,'label'=>'Device 2','serial'=>'DIOT02','details'=>'Replaced'),
    'GEN-AAAAAA'=>array('code'=>'GEN-AAAAAA','type'=>'generic','warehouse_id'=>1,'bin'=>'A01','product_id'=>3,'qty'=>1),
    'GEN-BBBBBB'=>array('code'=>'GEN-BBBBBB','type'=>'generic','warehouse_id'=>1,'bin'=>'A01','product_id'=>3,'qty'=>1),
    'BOX-AAAAAA'=>array('code'=>'BOX-AAAAAA','type'=>'box','warehouse_id'=>1,'bin'=>'A01','product_id'=>3,'qty'=>25),
    'BOX-BBBBBB'=>array('code'=>'BOX-BBBBBB','type'=>'box','warehouse_id'=>1,'bin'=>'A01','product_id'=>3,'qty'=>5),
    'BOX-CCCCCC'=>array('code'=>'BOX-CCCCCC','type'=>'box','warehouse_id'=>1,'bin'=>'A01','product_id'=>3,'qty'=>null),
    'BOX-DDDDDD'=>array('code'=>'BOX-DDDDDD','type'=>'box','warehouse_id'=>1,'bin'=>'A02','product_id'=>3,'qty'=>10),
);
$products=array(5=>array('ref'=>'CUBE','label'=>'DeltaCube'),3=>array('ref'=>'SOLAR','label'=>'Solar Lite'));
$sum=qrr_bin_summary($rows,1,'A01',$products);
assert(count($sum['tracked']) === 2);
assert(count($sum['totals']) === 1);
assert($sum['totals'][0]['generic'] === 2);
assert($sum['totals'][0]['box'] === 30);
assert($sum['totals'][0]['unknown_boxes'] === 1);
assert(qrr_bin_summary($rows,1,'A02',$products)['totals'][0]['box'] === 10);
$lines = array(array('product_id'=>3,'qty'=>20,'label'=>'Solar'),array('product_id'=>3,'qty'=>10,'label'=>'Solar'));
$picks=qrr_pick_proposal($lines,$rows,1,$products);
$total=0;
foreach($picks as $p) if($p['type'] !== 'missing') $total+=$p['take'];
assert($total===30.0 || $total===30);
$user=(object)array('id'=>1);
qrr_update(function (&$state) use ($rows){$state['items']=$rows;},$user,'test');
$again=qrr_load_state();
assert(count($again['items'])===8 && $again['revision']===1 && count($again['history'])===1);
@unlink(qrr_state_file());@unlink(qrr_data_dir().'/state.lock');@rmdir(qrr_data_dir());@rmdir(dirname(qrr_data_dir()));@rmdir($tmp);
echo "QR Router aggregation, order allocation, and atomic state tests passed.\n";
