<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';header('Content-Type: application/json; charset=UTF-8');header('Cache-Control: no-store');
if(!qrr_read_right($user)||!qrr_orders_right($user)){http_response_code(403);echo '[]';exit;}
$q=trim((string)GETPOST('q','alphanohtml'));$q=function_exists('mb_substr')?mb_substr($q,0,80,'UTF-8'):substr($q,0,80);
$sql='SELECT c.rowid,c.ref,s.nom AS customer FROM '.MAIN_DB_PREFIX.'commande c LEFT JOIN '.MAIN_DB_PREFIX.'societe s ON s.rowid=c.fk_soc WHERE c.entity IN ('.getEntity('commande').')';
if($q!==''){
    $escaped=$db->escape($q);
    $sql.=" AND (c.ref LIKE '%".$escaped."%' OR s.nom LIKE '%".$escaped."%')";
}
$sql.=' ORDER BY c.rowid DESC LIMIT 50';
$res=$db->query($sql);if(!$res){http_response_code(500);echo '[]';exit;}
$out=array();while($r=$db->fetch_object($res))$out[]=array('id'=>(int)$r->rowid,'text'=>(string)($r->ref.' — '.$r->customer));
echo json_encode($out,JSON_UNESCAPED_UNICODE|JSON_HEX_AMP|JSON_HEX_TAG);
