<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';
header('Content-Type: application/json; charset=UTF-8');header('Cache-Control: no-store');
if(!qrr_read_right($user)||!qrr_products_right($user)){http_response_code(403);echo '[]';exit;}
$q=trim((string)GETPOST('q','alphanohtml'));$q=mb_substr($q,0,80,'UTF-8');
// Empty filter returns the first 50 products for dropdown browsing.
$sql='SELECT rowid,ref,label FROM '.MAIN_DB_PREFIX.'product WHERE entity IN ('.getEntity('product').') AND fk_product_type=0';
$escaped=$db->escape($q);
if($q!=='') $sql.=" AND (ref LIKE '%".$escaped."%' OR label LIKE '%".$escaped."%')";
$sql.=' ORDER BY ref LIMIT 50';
$r=$db->query($sql);if(!$r){http_response_code(500);echo '[]';exit;}
$items=array();while($p=$db->fetch_object($r))$items[]=array('id'=>(int)$p->rowid,'text'=>(string)($p->ref.' — '.$p->label));
echo json_encode($items,JSON_UNESCAPED_UNICODE|JSON_HEX_TAG|JSON_HEX_AMP);
