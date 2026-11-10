"""Standalone Dolibarr HTTP and locale doubles used by the PHP gateway tests.

These fixtures intentionally approximate native APIs; production authorization
and stock behavior still require verification against the installed Dolibarr.
"""

MAIN = r'''<?php
session_start();
define('DOL_DOCUMENT_ROOT',__DIR__);
define('DOL_DATA_ROOT',dirname(__DIR__).'/data');
define('MAIN_DB_PREFIX','llx_');
$GLOBALS['conf']=(object)['entity'=>1];
$GLOBALS['user']=new class {public $id=8,$admin=1;public function hasRight(...$a){return true;}};
class FakeDB {
 public $rows=[],$idx=0,$txn=null;
 private function path(){return DOL_DATA_ROOT.'/native.json';}
 public function state(){return json_decode(file_get_contents($this->path()),true);}
 public function save($s){file_put_contents($this->path(),json_encode($s));}
 public function escape($s){return addslashes((string)$s);}
 public function query($sql){
  $this->rows=[];$this->idx=0;$s=$this->state();
  if(str_contains($sql,'FROM llx_entrepot')){
    foreach($s['warehouses'] as $wid=>$w)$this->rows[]=(object)['rowid'=>(int)$wid,'ref'=>$w['ref'],'lieu'=>$w['lieu']];
  }elseif(str_contains($sql,'FROM llx_product_stock')){
    preg_match('/fk_product IN \\(([^)]*)\\)/',$sql,$m);$ids=array_map('intval',explode(',',$m[1]??''));
    foreach($s['stock'] as $pid=>$warehouses)if(in_array((int)$pid,$ids,true))
      foreach($warehouses as $wid=>$qty)$this->rows[]=(object)['fk_product'=>(int)$pid,'fk_entrepot'=>(int)$wid,'reel'=>$qty];
  }elseif(str_contains($sql,'FROM llx_stock_mouvement')){
    preg_match("/inventorycode='([^']+)'/",$sql,$m);
    foreach($s['movements'] as $v)if($v['inventorycode']===stripslashes($m[1]??''))
      $this->rows[]=(object)$v;
  }elseif(str_contains($sql,'FROM llx_user')){
    $this->rows=[(object)['rowid'=>8,'firstname'=>'Alex','lastname'=>'Operator','login'=>'operator'],(object)['rowid'=>9,'firstname'=>'Taylor','lastname'=>'Technician','login'=>'technician']];
  }elseif(str_contains($sql,'FROM llx_mrp_mo')){
    $this->rows=[(object)['rowid'=>19,'ref'=>'MO-0019']];
  }elseif(str_contains($sql,'FROM llx_commande')){
    $this->rows=[(object)['rowid'=>39,'ref'=>'SO-0039','customer'=>'Example']];
  }elseif(str_contains($sql,'FROM llx_expedition')){
    $this->rows=[(object)['rowid'=>29,'ref'=>'SHP-0029']];
  }else return false;
  return true;
 }
 public function fetch_object($r){return $this->rows[$this->idx++]??false;}
 public function free($r){}
 public function lasterror(){return 'Unexpected query in fixture';}
 public function begin(){if($this->txn!==null)return -1;$this->txn=$this->state();return 1;}
 public function commit(){if($this->txn===null)return -1;$this->save($this->txn);$this->txn=null;return 1;}
 public function rollback(){$this->txn=null;return 1;}
 public function movement($pid,$wid,$units,$subtract,$inventorycode){
    $s=$this->txn??$this->state();
    $delta=$subtract?-$units:$units;
    $current=$s['stock'][$pid][$wid]??0;
    if($current+$delta<0)return -1;
    $s['stock'][$pid][$wid]=$current+$delta;
    $s['movements'][]=['fk_product'=>$pid,'fk_entrepot'=>$wid,'value'=>$delta,'inventorycode'=>$inventorycode];
    if($this->txn!==null)$this->txn=$s;else $this->save($s);
    return 1;
 }
 public function warehouse($name){
    $s=$this->state();$next=max(array_map('intval',array_keys($s['warehouses'])))+1;
    $s['warehouses'][$next]=['ref'=>$name,'lieu'=>$name,'status'=>1];$this->save($s);return $next;
 }
}
$GLOBALS['db']=new FakeDB();
function getEntity($key){return '1';}
function dol_buildpath($path,$type=0){return $type===0?DOL_DOCUMENT_ROOT.'/custom'.$path:'/custom'.$path;}
function GETPOST($key,$type=''){return $_POST[$key]??$_GET[$key]??'';}
function llxHeader($a,$title){print '<!doctype html><html><head><meta charset="utf-8"></head><body><main data-title="'.htmlspecialchars($title).'">';}
function llxFooter(){print '</main></body></html>';}
function accessforbidden($reason='Forbidden'){http_response_code(403);exit($reason);}
function newToken(){return 'fixture-dolibarr-token';}
function dol_syslog($msg,$severity=0){}
if(!defined('LOG_WARNING'))define('LOG_WARNING',4);
return 1;
'''

PRODUCT = r'''<?php
class Product {
 public $id,$type=0,$pmp=4,$ref='PART-003',$label='Fixture Part',$error='',$errors=[],$status_batch=0;
 private $db;
 public function __construct($db){$this->db=$db;}
 public function fetch($id){$this->id=(int)$id;return in_array((int)$id,[3,4],true)?1:-1;}
 public function hasbatch(){return false;}
 public function load_stock($mode=''){return 1;}
 public function correct_stock($user,$wid,$qty,$movement,$label='',$price=0,$inventorycode=''){
   return $this->db->movement($this->id,(int)$wid,(int)$qty,(int)$movement===1,$inventorycode);
 }
}
'''

WAREHOUSE = r'''<?php
class Entrepot {
 const STATUS_CLOSED=0; const STATUS_OPEN_ALL=1;
 public $status=1,$statut=1,$error='',$errors=[],$ref,$label,$lieu,$description;
 private $db;
 public function __construct($db){$this->db=$db;}
 public function fetch($wid){$w=$this->db->state()['warehouses'][(int)$wid]??null;if(!$w)return -1;$this->status=$w['status'];return 1;}
 public function create($user){return $this->db->warehouse($this->ref);}
}
'''

LANGS = r'''
class QrrHttpLangs {
 public $defaultlang; private $map=[];
 public function __construct($lang){$this->defaultlang=$lang;}
 public function load($domain){
  $path=__DIR__.'/custom/qrrouter/langs/'.$this->defaultlang.'/qrrouter.lang';
  foreach(file($path, FILE_IGNORE_NEW_LINES) as $line){
   if($line===''||$line[0]==='#'||strpos($line,'=')===false)continue;
   [$key,$val]=explode('=',$line,2);$this->map[$key]=$val;
  }
 }
 public function trans($key){return $this->map[$key]??$key;}
}
$GLOBALS['langs']=new QrrHttpLangs($_GET['testlang']??'en_US');
'''
