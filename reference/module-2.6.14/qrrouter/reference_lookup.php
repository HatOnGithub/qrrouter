<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_write_right($user))accessforbidden();
header('Content-Type: application/json; charset=utf-8');
try{
  $type=(string)GETPOST('type','alphanohtml');$q=trim((string)GETPOST('q','alphanohtml'));
  if(strlen($q)>100)throw new RuntimeException('Search is too long');
  $schema=qrr_reference_schema($type);
  if($type==='production'&&!(!empty($user->admin)||$user->hasRight('mrp','read')))throw new RuntimeException('MRP read permission required');
  if($type==='shipment'&&!(!empty($user->admin)||$user->hasRight('expedition','lire')))throw new RuntimeException('Shipment read permission required');
  if($type==='salesorder'&&!qrr_orders_right($user))throw new RuntimeException('Order read permission required');
  $sql='SELECT rowid,ref FROM '.MAIN_DB_PREFIX.$schema.' WHERE entity='.(int)$conf->entity;
  if($q!=='')$sql.=" AND ref LIKE '%".$db->escape($q)."%'";
  $sql.=' ORDER BY rowid DESC LIMIT 100';
  $rs=$db->query($sql);if(!$rs)throw new RuntimeException('Reference lookup unavailable');$out=array();while($r=$db->fetch_object($rs))$out[]=array('id'=>(int)$r->rowid,'text'=>(string)$r->ref);
  echo json_encode($out,JSON_THROW_ON_ERROR);
}catch(Throwable $e){http_response_code(400);echo json_encode(array('error'=>$e->getMessage()));}
