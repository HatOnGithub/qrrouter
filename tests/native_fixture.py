"""Persistent Dolibarr 21 / Binloc 2.19 contract doubles for the gateway suite."""

QUERIES = r'''
  if(str_contains($sql,'qrrouter_native_receipt')) {
    preg_match("/QRR-N-[A-F0-9]+/",$sql,$m);$id=$m[0]??'';
    if(str_starts_with($sql,'SELECT')) {if(isset($s['receipts'][$id]))$this->rows=[(object)['bindings'=>$s['receipts'][$id]]];}
    elseif(str_starts_with($sql,'INSERT')) {if(isset($s['receipts'][$id]))return false;$s['receipts'][$id]=str_contains($sql,'cancelled')?'{"cancelled":true}':'{}';}
    elseif(str_starts_with($sql,'UPDATE')) {preg_match("/SET bindings='((?:\\\\.|[^'])*)'/",$sql,$v);$s['receipts'][$id]=stripslashes($v[1]);}
    if($this->txn!==null)$this->txn=$s;else $this->save($s);
  }elseif(str_contains($sql,'FROM llx_product_batch')) {
    preg_match('/s.fk_product=(\d+)/',$sql,$p);preg_match('/s.fk_entrepot=(\d+)/',$sql,$w);
    preg_match("/b.batch='([^']+)'/",$sql,$b);
    if(str_contains($sql,'GROUP BY')) {
      foreach($s['batches'][$p[1]]??[] as $wid=>$batches)if(($batches[stripslashes($b[1])]??0)>0)$this->rows[]=(object)['fk_entrepot'=>(int)$wid,'qty'=>$batches[stripslashes($b[1])]];
    }else {
      $qty=$s['batches'][$p[1]][$w[1]][stripslashes($b[1])]??0;
      $this->rows=[(object)['qty'=>$qty,'eatby'=>null,'sellby'=>null]];
    }
  }elseif(str_contains($sql,'FROM llx_entrepot')){
'''

PRODUCT_METHOD = r'''
 public function correct_stock_batch($user,$wid,$qty,$movement,$label='',$price=0,$eatby=0,$sellby=0,$batch='',$inventorycode='') {
   $s=$this->db->txn??$this->db->state();
   if(!empty($s['fail_stock']))return -1;
   $current=$s['batches'][$this->id][$wid][$batch]??0;
   $delta=$movement===1?-$qty:$qty;
   if($current+$delta<0)return -1;
   $s['batches'][$this->id][$wid][$batch]=$current+$delta;
   if($this->db->txn!==null)$this->db->txn=$s;else $this->db->save($s);
   $result=$this->db->movement($this->id,(int)$wid,(int)$qty,$movement===1,$inventorycode);
   if($result<0)return $result;
   $s=$this->db->txn??$this->db->state();$last=count($s['movements'])-1;$s['movements'][$last]['batch']=$batch;
   // Binloc 2.19 clears a lot assignment on every outgoing stock movement.
   if($delta<0)foreach($s['lots'] as $id=>$lot)if($lot['fk_product']===$this->id&&$lot['batch']===$batch)unset($s['locations'][$id]);
   if($this->db->txn!==null)$this->db->txn=$s;else $this->db->save($s);return 1;
 }
'''

LOT = r'''<?php
class Productlot {
 public $id,$fk_product,$entity=1,$batch,$eatby=0,$sellby=0,$error=''; private $db;
 public function __construct($db){$this->db=$db;}
 public function fetch($id=0,$product=0,$batch='') {
   $s=$this->db->txn??$this->db->state();
   foreach($s['lots']??[] as $key=>$lot) {
     if(($id&&(int)$key===$id)||(!$id&&$lot['fk_product']===$product&&$lot['batch']===$batch)) {
       $this->id=(int)$key;foreach($lot as $k=>$v)$this->$k=$v;return 1;
     }
   }
   return 0;
 }
 public function create($user) {
   $s=$this->db->txn??$this->db->state();$this->id=count($s['lots']??[])+1;
   $s['lots'][$this->id]=['fk_product'=>$this->fk_product,'batch'=>$this->batch,'entity'=>$this->entity];
   if($this->db->txn!==null)$this->db->txn=$s;else $this->db->save($s);return $this->id;
 }
}
'''

LOCATION = r'''<?php
class BinlocProductLocation {
 public $fk_product,$fk_entrepot,$fk_product_lot,$values=[],$error=''; private $db;
 public function __construct($db){$this->db=$db;}
 public function fetchAnyByLot($id) {
   $s=$this->db->txn??$this->db->state();$entry=$s['locations'][$id]??null;
   if(!$entry)return 0;
   foreach($entry as $key=>$value) {
     if($key==='values') {$this->values=[];foreach($value as $level=>$v)$this->values[$level]=(object)$v;}
     else $this->$key=$value;
   }
   return 1;
 }
 public function setRawValues($levels,$values) {
   $this->values=[];
   foreach($values as $id=>$value)$this->values[$id]=(object)['fk_option'=>null,'value'=>(string)$value,'display'=>(string)$value];
   return 1;
 }
 public function createOrUpdate($user) {
   $s=$this->db->txn??$this->db->state();
   if(!empty($s['fail_location']))return -1;
   $s['locations'][$this->fk_product_lot]=['fk_product'=>$this->fk_product,'fk_entrepot'=>$this->fk_entrepot,'fk_product_lot'=>$this->fk_product_lot,'values'=>$this->values];
   if($this->db->txn!==null)$this->db->txn=$s;else $this->db->save($s);return 1;
 }
}
'''

LEVELS = r'''<?php
class BinlocWarehouseLevel {
 public function __construct($db){}
 public function fetchByWarehouse($wid){return [1=>(object)['id'=>1,'label'=>'Shelf','datatype'=>'text','options'=>[]]];}
}
'''

LIBRARY = r'''<?php
function binloc_get_label_layout($db,$warehouse,$level){return (object)['code_sep'=>'-','show_warehouse'=>false];}
'''
