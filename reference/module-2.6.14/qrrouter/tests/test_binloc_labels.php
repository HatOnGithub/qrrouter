<?php
error_reporting(E_ALL);
$root=sys_get_temp_dir().'/qrrouter-label-test-'.bin2hex(random_bytes(4));
define('DOL_DOCUMENT_ROOT',$root);
define('DOL_DATA_ROOT',$root.'/data');
$conf=(object)array('entity'=>1);
require_once __DIR__.'/../lib/qrrouter.lib.php';
$levels=array(
  1=>(object)array('label'=>'Aisle','datatype'=>'list','options'=>array((object)array('id'=>10,'value'=>'A'),(object)array('id'=>11,'value'=>'B'))),
  2=>(object)array('label'=>'Rack','datatype'=>'text','options'=>array()),
  3=>(object)array('label'=>'Shelf','datatype'=>'number','options'=>array()),
  4=>(object)array('label'=>'Position','datatype'=>'text','options'=>array()),
);
$values=array(1=>10,2=>'R2',3=>'03',4=>'B');
$prefs=qrr_binloc_validate_label_settings($levels,array(
 'show'=>array(3=>1,4=>1),
 'separator'=>array(1=>'/',2=>'-',3=>'-',4=>''),
));
assert($prefs['show']===array('3'=>1,'4'=>1) || $prefs['show']===array(3=>1,4=>1));
assert(qrr_binloc_label_for_values($levels,$values,$prefs)==='03B');
assert(qrr_binloc_label_for_values($levels,$values,$prefs,'WH1')==='03B');
$prefs['separator'][4]='-';
assert(qrr_binloc_label_for_values($levels,$values,$prefs)==='03-B');
$prefs['show_warehouse']=true;
assert(qrr_binloc_label_for_values($levels,$values,$prefs,'WH1')==='WH1-03-B');
// The same local label can refer to distinct physical racks: full identifiers remain separate.
assert(qrr_binloc_label_for_values($levels,array(1=>11,2=>'R8',3=>'03',4=>'B'),$prefs,'WH1')==='WH1-03-B');
assert(qrr_binloc_label_for_values($levels,$values,array('enabled'=>true,'show'=>array(4=>1),'separator'=>array(4=>'')))==='B');
// Missing/skipped configured levels must not leak raw option IDs to the label.
assert(qrr_binloc_label_for_values($levels,array(1=>900),array('enabled'=>true,'show'=>array(1=>1)))==='');
assert(qrr_binloc_label_for_values($levels,$values,array('enabled'=>true,'show'=>array(9=>1),'show_warehouse'=>true),'WH1')==='');
try { qrr_binloc_validate_label_settings($levels,array('show'=>array(),'separator'=>array())); assert(false); }
catch (RuntimeException $e) { assert(strpos($e->getMessage(),'At least one')!==false); }
try { qrr_binloc_validate_label_settings($levels,array('show'=>array(3=>1),'separator'=>array(3=>str_repeat('X',13)))); assert(false); }
catch (RuntimeException $e) { assert(strpos($e->getMessage(),'separator')!==false); }
try { qrr_binloc_validate_label_settings($levels,array('show'=>array(3=>1),'separator'=>array(3=>array('bad')))); assert(false); }
catch (RuntimeException $e) { assert(strpos($e->getMessage(),'separator')!==false); }
// Backward compatible: state file stores preferences without mutating item location keys.
$user=(object)array('id'=>5,'admin'=>1);
qrr_update(function (&$state) use($prefs) {
  $state['binloc_label_settings']['7']=$prefs;
  $state['items']['ITM-ABCDEF']=qrr_make_item('ITM-ABCDEF','tracked','Test',4,7,array('bin'=>'WH1/A/R2/03/B','bin_key'=>'1:o10|2:vR2|3:v03|4:vB','bin_values'=>array(1=>10,2=>'R2',3=>'03',4=>'B')));
},$user,'test_local_label');
$state=qrr_load_state();
assert(qrr_binloc_label_settings(7,$state)['enabled']);
assert($state['items']['ITM-ABCDEF']['bin']==='WH1/A/R2/03/B');
assert($state['items']['ITM-ABCDEF']['bin_key']==='1:o10|2:vR2|3:v03|4:vB');
@unlink(qrr_state_file());@unlink(qrr_data_dir().'/state.lock');@rmdir(qrr_data_dir());@rmdir(dirname(qrr_data_dir()));@rmdir(DOL_DATA_ROOT);@rmdir($root);
echo "Local Binloc label configuration, separators, omission and location identity tests passed.\n";
