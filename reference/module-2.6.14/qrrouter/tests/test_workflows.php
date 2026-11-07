<?php
/** Offline v2.6.0 workflow tests with mock native movement methods. */
error_reporting(E_ALL);
$root=sys_get_temp_dir().'/qrr-workflows-'.bin2hex(random_bytes(4));
mkdir($root.'/product/class',0700,true);mkdir($root.'/product/stock/class',0700,true);
define('DOL_DOCUMENT_ROOT',$root);define('DOL_DATA_ROOT',$root.'/data');define('MAIN_DB_PREFIX','llx_');
$conf=(object)array('entity'=>1);
function getEntity($type){return '1';}
class StubDB {
 public $stock=array(3=>array(1=>12,2=>0)), $movements=array(), $rows=array(), $idx=0;
 public function escape($s){return addslashes($s);}
 public function query($sql){$this->idx=0;$this->rows=array();
  if(str_contains($sql,'FROM llx_stock_mouvement')){
   preg_match("/inventorycode='([^']+)'/",$sql,$m);foreach($this->movements as $row)if($row->inventorycode===stripslashes($m[1]??''))$this->rows[]=$row;
  }elseif(str_contains($sql,'FROM llx_product_stock')){
   preg_match('/fk_product IN \\(([^)]+)\\)/',$sql,$m);$wanted=array_map('intval',explode(',',$m[1]??''));
   foreach($this->stock as $pid=>$warehouses)if(in_array($pid,$wanted,true))foreach($warehouses as $wid=>$units)$this->rows[]=(object)array('fk_product'=>$pid,'fk_entrepot'=>$wid,'reel'=>$units);
  }elseif(str_contains($sql,'FROM llx_entrepot')){
   $this->rows=array((object)array('rowid'=>1,'ref'=>'MAIN','lieu'=>'Main Warehouse'),(object)array('rowid'=>2,'ref'=>'SECOND','lieu'=>'Other Warehouse'));
  }elseif(str_contains($sql,'FROM llx_mrp_mo')){
   $this->rows=array((object)array('rowid'=>19));
  }else throw new RuntimeException('Unexpected SQL '.$sql);
  return true;
 }
 public function fetch_object($rs){return $this->rows[$this->idx++]??false;}
 public function free($rs){} public function begin(){return 1;} public function commit(){return 1;} public function rollback(){return 1;}
 public function lasterror(){return 'stub error';}
 public function logStock($pid,$wid,$n,$decrease,$code){$delta=$decrease?-$n:$n;$this->stock[$pid][$wid]=($this->stock[$pid][$wid]??0)+$delta;$this->movements[]=(object)array('fk_product'=>$pid,'fk_entrepot'=>$wid,'value'=>$delta,'inventorycode'=>$code);return 1;}
}
file_put_contents($root.'/product/class/product.class.php',<<<'STUB'
<?php
class Product {
 public $id=0,$type=0,$pmp=1.0,$ref='PART-3',$label='Part 3',$error='',$errors=array();private $db;
 public function __construct($db){$this->db=$db;}
 public function fetch($id){$this->id=(int)$id;return 1;}
 public function load_stock($mode=''){return 1;}
 public function hasbatch(){return false;}
 public function correct_stock($user,$warehouse,$qty,$decrease,$label,$price,$inventorycode){return $this->db->logStock($this->id,$warehouse,$qty,$decrease,$inventorycode);}
}
STUB
);
file_put_contents($root.'/product/stock/class/entrepot.class.php',<<<'STUB'
<?php
class Entrepot {
 const STATUS_CLOSED=0;public $status=1;public static $closed=array();
 public function __construct($db){}
 public function fetch($id){$this->status=in_array((int)$id,self::$closed,true)?self::STATUS_CLOSED:1;return in_array((int)$id,array(1,2),true)?1:-1;}
}
STUB
);
require_once __DIR__.'/../lib/qrrouter.lib.php';
$user=new class {public $id=8,$admin=1;public function hasRight(...$args){return true;}};
$db=new StubDB();$ws=qrr_warehouses($db);
// Dolibarr 21 uses mrp.read, not mrp.lire. Both lookup and posting must agree.
$mrpReader=new class {public $admin=0;public function hasRight(...$right){return $right===array('mrp','read');}};
qrr_check_reference($db,$mrpReader,'production',19);
$mrpDenied=new class {public $admin=0;public function hasRight(...$right){return false;}};
try {qrr_check_reference($db,$mrpDenied,'production',19);assert(false);}catch(RuntimeException $e){assert(str_contains($e->getMessage(),'permission'));}

$code='ITM-ABCDEF';$box='BOX-ABCDEF';$generic='GEN-ABCDEF';
qrr_update(function(&$s)use($code,$box,$generic){$s['items'][$code]=qrr_make_item($code,'unassigned');$s['items'][$box]=qrr_make_item($box,'unassigned');$s['items'][$generic]=qrr_make_item($generic,'unassigned');},$user,'test_init');
$choice=array('bin'=>'A-1','bin_key'=>'','bin_values'=>array());
$tracked=array('label'=>'Sensor','product_id'=>3,'warehouse_id'=>1,'choice'=>$choice,'qty'=>1,'details'=>'','serial'=>'SN01','native_batch'=>'');
qrr_register_codes($db,$user,array($code),'tracked',$tracked);
qrr_register_codes($db,$user,array($generic),'generic',array_merge($tracked,array('serial'=>'','details'=>'')));
qrr_register_codes($db,$user,array($box),'box',array_merge($tracked,array('qty'=>5,'serial'=>'')));
assert(qrr_load_state()['items'][$box]['qty']===5);
try{qrr_register_codes($db,$user,array($code),'tracked',$tracked);assert(false);}catch(RuntimeException $e){assert(str_contains($e->getMessage(),'unassigned'));}
assert(count($db->movements)===0);
// In-warehouse move changes QR bin only.
qrr_run_inventory_action($db,$user,$code,'move',array('warehouse_id'=>1,'choice'=>array('bin'=>'B-2','bin_key'=>'','bin_values'=>array())),$ws);
assert(count($db->movements)===0 && qrr_load_state()['items'][$code]['bin']==='B-2');
// A closed warehouse is rejected before staging; a user must not be forced to reconcile a no-op.
require_once DOL_DOCUMENT_ROOT.'/product/stock/class/entrepot.class.php';
Entrepot::$closed=array(2);
try{qrr_run_inventory_action($db,$user,$code,'move',array('warehouse_id'=>2,'choice'=>$choice),$ws);assert(false);}catch(RuntimeException $e){assert(str_contains($e->getMessage(),'closed'));}
assert(!isset(qrr_load_state()['items'][$code]['pending_operation']));
assert(count($db->movements)===0);
Entrepot::$closed=array();
// Cross-warehouse move creates exactly two movements.
qrr_run_inventory_action($db,$user,$code,'move',array('warehouse_id'=>2,'choice'=>$choice),$ws);
assert(count($db->movements)===2 && $db->stock[3][1]===11 && $db->stock[3][2]===1);
assert(qrr_load_state()['items'][$code]['warehouse_id']===2);
// Partial consumption and return of a counted box.
qrr_run_inventory_action($db,$user,$box,'consume',array('quantity'=>3,'post_stock'=>true,'reason'=>'manufacturing'),$ws);
assert(qrr_load_state()['items'][$box]['qty']===2 && qrr_load_state()['items'][$box]['consumed_units']===3);
assert($db->stock[3][1]===8);
try{qrr_run_inventory_action($db,$user,$box,'return',array('warehouse_id'=>2,'quantity'=>1,'choice'=>$choice,'post_stock'=>true),$ws);assert(false);}catch(RuntimeException $e){assert(str_contains($e->getMessage(),'current warehouse'));}
qrr_run_inventory_action($db,$user,$box,'return',array('warehouse_id'=>1,'quantity'=>2,'choice'=>$choice,'post_stock'=>true),$ws);
assert(qrr_load_state()['items'][$box]['qty']===4 && qrr_load_state()['items'][$box]['consumed_units']===1);
assert($db->stock[3][1]===10);
// Consumed unique can be reactivated without losing identity.
qrr_run_inventory_action($db,$user,$code,'consume',array('quantity'=>1,'post_stock'=>true,'reason'=>'field work'),$ws);
assert(qrr_item_status(qrr_load_state()['items'][$code])==='consumed');
try{qrr_run_inventory_action($db,$user,$code,'move',array('warehouse_id'=>1,'choice'=>$choice),$ws);assert(false);}catch(RuntimeException $e){assert(str_contains($e->getMessage(),'consumed'));}
qrr_run_inventory_action($db,$user,$code,'return',array('warehouse_id'=>2,'quantity'=>1,'choice'=>$choice,'post_stock'=>true),$ws);
assert(qrr_item_status(qrr_load_state()['items'][$code])==='in_stock');
// Corrections use actual native adjustment (not QR-only quantity manipulation).
$before=$db->stock[3][1];qrr_run_inventory_action($db,$user,$box,'correct',array('quantity'=>6,'reason'=>'inventory count'),$ws);
assert(qrr_load_state()['items'][$box]['qty']===6 && $db->stock[3][1]===$before+2);
assert(!isset(qrr_load_state()['items'][$box]['pending_operation']));
// No duplicate consumption after returning to checked-out state.
$hist=qrr_load_state()['history'];assert(count($hist)>12);
// Simulate evidence-less interrupted stock operation and cancel safely after 30s.
qrr_update(function(&$s)use($box){$s['items'][$box]['pending_operation']=array('id'=>'QRR-MOCKCANCEL','kind'=>'consume','at'=>'2020-01-01T00:00:00Z','product_id'=>3,'effects'=>array(array('warehouse_id'=>1,'delta'=>-1)),'patch'=>array('qty'=>5),'reason'=>'','reference_type'=>'','reference_id'=>0,'amount'=>1);},$user,'test_pending');
assert(str_contains(qrr_reconcile_inventory_action($db,$user,$box),'Cancelled'));
assert(!isset(qrr_load_state()['items'][$box]['pending_operation']));
// A crashed PHP request after a native commit must finalize from native evidence, never post twice.
$recover=array('id'=>'QRR-RECOVERYTEST','kind'=>'consume','at'=>'2020-01-01T00:00:00Z','product_id'=>3,
  'effects'=>array(array('warehouse_id'=>1,'delta'=>-1)),'patch'=>array('qty'=>5,'status'=>'in_stock','consumed_units'=>2),
  'reason'=>'recovery','reference_type'=>'','reference_id'=>0,'amount'=>1);
qrr_update(function(&$s)use($box,$recover){$s['items'][$box]['pending_operation']=$recover;},$user,'test_after_commit');
$db->logStock(3,1,1,true,$recover['id']);
$movementsBefore=count($db->movements);
assert(str_contains(qrr_reconcile_inventory_action($db,$user,$box),'Completed'));
assert(count($db->movements)===$movementsBefore);
assert(qrr_load_state()['items'][$box]['qty']===5);
assert(!isset(qrr_load_state()['items'][$box]['pending_operation']));
function rr($path){if(is_dir($path)){foreach(scandir($path) as $a)if($a!=='.'&&$a!=='..')rr($path.'/'.$a);rmdir($path);}else if(is_file($path))unlink($path);}
rr($root);
echo "v2.6 QR registration, internal/external moves, native consumption, returns, correction and reconciliation tests passed.\n";
