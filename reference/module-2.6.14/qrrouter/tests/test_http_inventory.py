#!/usr/bin/env python3
"""HTTP-to-native-stock contract integration tests with persistent Dolibarr 21-shaped fixture.
No external Dolibarr server is accessed. Run in a disposable temporary filesystem.
"""
import contextlib
import http.cookiejar
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.error
import urllib.request

SOURCE=Path(__file__).resolve().parents[1]
MAIN=r'''<?php
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
PRODUCT=r'''<?php
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
WAREHOUSE=r'''<?php
class Entrepot {
 const STATUS_CLOSED=0; const STATUS_OPEN_ALL=1;
 public $status=1,$statut=1,$error='',$errors=[],$ref,$label,$lieu,$description;
 private $db;
 public function __construct($db){$this->db=$db;}
 public function fetch($wid){$w=$this->db->state()['warehouses'][(int)$wid]??null;if(!$w)return -1;$this->status=$w['status'];return 1;}
 public function create($user){return $this->db->warehouse($this->ref);}
}
'''
BINLOC=r'''<?php
class BinlocWarehouseLevel {
 public function __construct($db){}
 public function fetchByWarehouse($wid){return [];}
}
'''

def run():
 with tempfile.TemporaryDirectory(prefix='qrrouter-inventory-http-') as temp:
  tmp=Path(temp); webroot=tmp/'htdocs';data=tmp/'data';data.mkdir()
  install=webroot/'custom'/'qrrouter';shutil.copytree(SOURCE,install,ignore=shutil.ignore_patterns('tests'))
  for folder in ['product/class','product/stock/class','custom/binloc/class']:(webroot/folder).mkdir(parents=True,exist_ok=True)
  for target,source in {'main.inc.php':MAIN,'product/class/product.class.php':PRODUCT,'product/stock/class/entrepot.class.php':WAREHOUSE,'custom/binloc/class/binlocwarehouselevel.class.php':BINLOC}.items(): (webroot/target).write_text(source)
  dbfile=data/'native.json';dbfile.write_text(json.dumps({'warehouses':{'1':{'ref':'MAIN','lieu':'Main','status':1},'2':{'ref':'OTHER','lieu':'Other','status':1}},'stock':{'3':{'1':30,'2':4}},'movements':[]}))
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  log=open(tmp/'php.log','w');proc=subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t',str(webroot)],stdout=log,stderr=log)
  try:
   client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),urllib.request.HTTPRedirectHandler())
   base=f'http://127.0.0.1:{port}/custom/qrrouter/'
   def req(page,post=None):
    body=urllib.parse.urlencode(post,doseq=True).encode() if post is not None else None
    try:
     with client.open(base+page,body,timeout=10) as response:return response.status,response.geturl(),response.read().decode(errors='replace')
    except urllib.error.HTTPError as e:return e.code,e.geturl(),e.read().decode(errors='replace')
   for i in range(50):
    try: req('index.php');break
    except (ConnectionError,urllib.error.URLError):time.sleep(.05)
   statefile=data/'qrrouter/entity-1/state.json'
   def state():return json.loads(statefile.read_text())
   def native():return json.loads(dbfile.read_text())
   def stock(wid):return native()['stock']['3'][str(wid)]
   def request(page,post=None,needle=None):
    status,url,html=req(page,post)
    assert status==200,(page,status,html[:800])
    if needle:assert needle in html,(page,needle,html[:1200])
    return url,html
   _,printpage=request('print_codes.php');token=re.search('name="qrr_token" value="([^"]+)"',printpage).group(1)
   request('print_codes.php',{'count':'4','qrr_token':token},'Print')
   codes=list(state()['items']);code,box,generic,other=codes
   for entry,mode,qty in [(code,'unique',1),(box,'box',5),(generic,'generic',1)]:
    regmode={'unique':'tracked','box':'box','generic':'generic'}[mode]
    request('register.php',{'step':'save','mode':mode,'codes':entry,'label':'Fixture unit','product_id':3,'warehouse_id':1,'serial':'SN123' if mode=='unique' else '','qty':qty,'qrr_token':token,'next':'finish'},'Register')
    assert state()['items'][entry]['type']==regmode
   assert stock(1)==30,'Registration must not post native stock.'
   # Rejected CSRF for a mutating route.
   status,_,csrf=req('workflow.php',{'action':'move','step':'perform','selected[]':[code],'warehouse_id':2,'qrr_token':'bad-token'})
   assert 'Invalid or expired form token' in csrf
   assert stock(1)==30 and stock(2)==4
   # Same warehouse move: location only.
   request('workflow.php',{'action':'move','step':'perform','selected[]':[code],'warehouse_id':'1','qrr_token':token},'1 of 1 completed')
   assert stock(1)==30
   # Cross warehouse transfer: two native stock movements, one inventory code.
   request('workflow.php',{'action':'move','step':'perform','selected[]':[code],'warehouse_id':'2','qrr_token':token},'1 of 1 completed')
   assert stock(1)==29 and stock(2)==5
   assert state()['items'][code]['warehouse_id']==2
   moves=native()['movements'];assert len(moves)==2 and moves[0]['inventorycode']==moves[1]['inventorycode']
   # Quantity-based box: link manufacturing order, deduct 3, keep 2.
   request('workflow.php',{'action':'consume','step':'perform','selected[]':[box],'quantities['+box+']':3,'reference_type':'production','reference_id':'19','reason':'assembly','stock_mode':'native','qrr_token':token},'1 of 1 completed')
   assert stock(1)==26 and state()['items'][box]['qty']==2 and state()['items'][box]['consumed_units']==3
   # Return 2 units and post stock increment.
   request('return.php?code='+box,{'code':box,'quantity':2,'warehouse_id':1,'post_stock':1,'qrr_token':token,'reason':'unused'},'Returned 2 unit(s)')
   assert stock(1)==28 and state()['items'][box]['qty']==4 and state()['items'][box]['consumed_units']==1
   # Native count correction: +1 to warehouse.
   request('correction.php?code='+box,{'code':box,'new_qty':5,'reason':'stock count variance','qrr_token':token},'Stock correction saved')
   assert stock(1)==29 and state()['items'][box]['qty']==5
   # Consume an individually tracked unit, QR-only because Dolibarr already adjusted stock.
   request('workflow.php',{'action':'consume','step':'perform','selected[]':[code],'reason':'shipment','reference_type':'salesorder','reference_id':39,'stock_mode':'already_posted','qrr_token':token},'1 of 1 completed')
   assert stock(2)==5 and state()['items'][code]['status']=='consumed'
   # Return tracked unit to stock, native increase in warehouse 2.
   request('return.php?code='+code,{'code':code,'quantity':1,'warehouse_id':2,'post_stock':1,'qrr_token':token},'Returned 1 unit(s)')
   assert stock(2)==6 and state()['items'][code]['status']=='in_stock'
   # Checkout generic unit to auto-created warehouse and checkin to original.
   request('workflow.php',{'action':'checkout','step':'perform','selected[]':[generic],'person_id':9,'qrr_token':token,'reason':'field inspection'},'1 of 1 completed')
   wmap=state()['personal_warehouses'];personal=int(wmap['9']);assert personal>2 and state()['items'][generic]['warehouse_id']==personal
   assert stock(1)==28 and stock(personal)==1
   request('workflow.php',{'action':'checkin','step':'perform','selected[]':[generic],'qrr_token':token},'1 of 1 completed')
   assert stock(1)==29 and stock(personal)==0 and state()['items'][generic]['warehouse_id']==1
   assert 'checkout' not in state()['items'][generic]
   # No dangling QR staging markers after successful operations.
   assert all('pending_operation' not in x and 'pending_handoff' not in x for x in state()['items'].values())
   assert len(native()['movements'])==10,(len(native()['movements']),native()['movements'])
   # Integration failure handling: closed warehouse is refused before staging any QR pending operation.
   before=state()['revision'];saved=native();saved['warehouses']['2']['status']=0;dbfile.write_text(json.dumps(saved))
   request('workflow.php',{'action':'move','step':'perform','selected[]':[box],'warehouse_id':2,'qrr_token':token},'0 of 1 completed')
   assert stock(1)==29 and state()['revision']==before,'Closed-warehouse refusal must not stage a native transfer'
   assert 'pending_operation' not in state()['items'][box]
   saved['warehouses']['2']['status']=1;dbfile.write_text(json.dumps(saved))
   # Insufficient stock must not generate a partial transfer or change QR quantity.
   saved=native();saved['stock']['3']['1']=1;dbfile.write_text(json.dumps(saved))
   before=len(native()['movements']);revision=state()['revision']
   request('workflow.php',{'action':'move','step':'perform','selected[]':[box],'warehouse_id':2,'qrr_token':token},'0 of 1 completed')
   assert len(native()['movements'])==before and state()['revision']==revision
   assert state()['items'][box]['qty']==5 and 'pending_operation' not in state()['items'][box]
   # A multi-item operation commits a successful QR and reports the failure separately.
   # Use a generic label already in stock and an empty-count box (QR-only within same warehouse).
   # For two serialised units, the next test verifies a duplicate scan is not double-posted.
   saved['stock']['3']['1']=29;dbfile.write_text(json.dumps(saved))
   count=len(native()['movements'])
   request('workflow.php',{'action':'move','step':'perform','selected[]':[box,box],'warehouse_id':2,'qrr_token':token},'1 of 1 completed')
   assert state()['items'][box]['warehouse_id']==2
   assert len(native()['movements'])==count+2,'Duplicate QR in form must create only one transfer'
   # Invalid reference cannot silently consume stock.
   count=len(native()['movements']);rev=state()['revision']
   request('workflow.php',{'action':'consume','step':'perform','selected[]':[box],'quantities['+box+']':1,'reference_type':'production','reference_id':0,'stock_mode':'native','qrr_token':token},'Select an exact shipment or order')
   assert len(native()['movements'])==count and state()['revision']==rev
   print('HTTP inventory contract integration PASS: CSRF, registration, transfers, order references, consumption, returns, correction, checkout/in, native inventory evidence and negative cases.')
  finally:
   proc.terminate()
   with contextlib.suppress(Exception):proc.wait(timeout=2)
   log.close()

if __name__=='__main__':run()
