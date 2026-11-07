<?php
/** Offline regression tests for v2.5; do not run against production state. */
error_reporting(E_ALL);
$root=sys_get_temp_dir().'/qrrouter-native-test-'.bin2hex(random_bytes(5));
mkdir($root.'/product/stock/class',0700,true);
define('DOL_DOCUMENT_ROOT',$root);
define('DOL_DATA_ROOT',$root.'/data');
define('MAIN_DB_PREFIX','llx_');
$conf=(object)array('entity'=>1);
function getEntity($name){return '1';}
class StubDB {
 public $rows=array(),$index=0,$warehouses=array();
 public function query($sql){$this->index=0;
   if(strpos($sql,'llx_user')!==false)$this->rows=array((object)array('rowid'=>2,'login'=>'vera','firstname'=>'Vera','lastname'=>'Test'));
   elseif(strpos($sql,'llx_entrepot')!==false)$this->rows=array_map(function($id,$row){return(object)array_merge(array('rowid'=>$id),$row);},array_keys($this->warehouses),array_values($this->warehouses));
   else throw new RuntimeException('Unexpected test query: '.$sql);
   return true;
 }
 public function fetch_object($res){return $this->rows[$this->index++]??false;}
 public function free($res){}
 public function lasterror(){return '';}
}
file_put_contents($root.'/product/stock/class/entrepot.class.php',<<<'NATIVE'
<?php
class Entrepot {
 const STATUS_OPEN_ALL=1;
 public $ref,$label,$lieu,$description,$statut,$error='', $errors=array(), $db;
 public function __construct($db){$this->db=$db;}
 public function create($user){$id=count($this->db->warehouses)+1;while(isset($this->db->warehouses[$id]))$id++;$this->db->warehouses[$id]=array('ref'=>$this->label,'lieu'=>$this->lieu);return $id;}
}
NATIVE
);
require_once __DIR__.'/../lib/qrrouter.lib.php';
assert(qrr_code_valid('ITM-ABCDEF'));
assert(!qrr_code_valid('abc'));
$items=array();for($i=0;$i<300;$i++){$code=qrr_unique_code($items);assert(strlen($code)===6&&qrr_code_valid($code));$items[$code]=qrr_make_item($code,'unassigned');}
assert(count($items)===300);
assert(qrr_warehouse_summary($items,1)===array());
$code=qrr_unique_code($items);$items[$code]=qrr_make_item($code,'generic','Accessory',3,1,array('bin'=>'A01','bin_key'=>'1:o5','bin_values'=>array(1=>5)));
$sum=qrr_bin_summary($items,1,'A01',array(3=>array('ref'=>'SOL','label'=>'Solar Lite')));
assert($sum['totals'][0]['generic']===1);
$user=(object)array('id'=>7,'admin'=>1);
qrr_update(function (&$s)use($items){$s['items']=$items;},$user,'test_batch');
assert(count(qrr_load_state()['items'])===301);
$db=new StubDB();$users=qrr_personal_users($db);assert($users[2]==='Vera Test (vera)');
$warehouseId=qrr_ensure_personal_warehouse($db,$user,2,$users);
assert($warehouseId>0 && $db->warehouses[$warehouseId]['ref']==='Vera Test');
assert(qrr_ensure_personal_warehouse($db,$user,2,$users)===$warehouseId);
assert((int)qrr_load_state()['personal_warehouses'][2]===$warehouseId);
// A second employee with the same name must not take over a mapped warehouse.
try{qrr_ensure_personal_warehouse($db,$user,3,array(3=>'Vera Test (other)'));assert(false);}catch(RuntimeException $e){assert(strpos($e->getMessage(),'another user')!==false);}
function deleteTree($path){if(is_dir($path)){foreach(scandir($path) as $x)if($x!=='.'&&$x!=='..')deleteTree($path.'/'.$x);rmdir($path);}elseif(file_exists($path))unlink($path);}
deleteTree($root);
echo "v2.5 QR entropy, blank batch, aggregation and employee warehouse creation tests passed.\n";
