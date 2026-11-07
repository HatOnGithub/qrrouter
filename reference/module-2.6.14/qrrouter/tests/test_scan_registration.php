<?php
/** Offline tests for QR batch navigation data and captured QR thumbnails. */
error_reporting(E_ALL);
$root=sys_get_temp_dir().'/qrr-scans-'.bin2hex(random_bytes(5));
mkdir($root,0700,true);
define('DOL_DOCUMENT_ROOT',$root);
define('DOL_DATA_ROOT',$root.'/data');
$conf=(object)array('entity'=>1);
require_once __DIR__.'/../lib/qrrouter.lib.php';
function qrr_scan_assert($test,$message){if(!$test)throw new RuntimeException($message);}
$codes=array('ITM-ABCDEF','ITM-ABCDFF','ITM-ABCDGG','ITM-ABCDHH');
$state=qrr_blank();
foreach($codes as $code)$state['items'][$code]=qrr_make_item($code,'unassigned');
$state['items'][$codes[1]]=qrr_make_item($codes[1],'tracked');
$state['items'][$codes[3]]=qrr_make_item($codes[3],'tracked');
$state['batches']=array(
 'A'=>array('created_at'=>'2026-11-01T10:00:00Z','codes'=>array($codes[0],$codes[1])),
 'B'=>array('created_at'=>'2026-11-02T10:00:00Z','codes'=>array($codes[3] )),
);
$stats=qrr_unassigned_batches($state);
qrr_scan_assert($stats['unassigned_total']===2,'Unassigned count should include outside-batch labels');
qrr_scan_assert($stats['remaining_batches']===1,'Only one printed batch still has unused labels');
qrr_scan_assert($stats['batches']['A']['unassigned']===1,'Batch A should have one free label');
qrr_scan_assert($stats['batches']['B']['unassigned']===0,'Fully assigned batch should be filtered out in UI');
qrr_scan_assert($stats['unbatched']===array($codes[2]),'Standalone unassigned label must be listed');
qrr_scan_assert(array_key_first($stats['batches'])==='B','Batches should sort newest first');
$image=file_get_contents(__DIR__.'/fixtures/qr_scan.jpg');
$encoded='data:image/jpeg;base64,'.base64_encode($image);
$decoded=qrr_thumbnail_decode($encoded);
qrr_scan_assert($decoded===$image,'Scan JPEG should round trip');
qrr_thumbnail_store($codes[0],$decoded);
qrr_scan_assert(qrr_thumbnail_exists($codes[0]),'Protected thumbnail should be saved');
qrr_scan_assert(file_get_contents(qrr_thumbnail_path($codes[0]))===$image,'Stored image should be identical');
qrr_scan_assert(!qrr_thumbnail_exists($codes[1]),'Other QR code must not inherit scan thumbnail');
foreach(array('data:text/html;base64,QQ==','data:image/png;base64,QQ==','data:image/jpeg;base64,INVALID','data:image/jpeg;base64,'.str_repeat('A',105000)) as $bad){
 $failed=false;try{qrr_thumbnail_decode($bad);}catch(RuntimeException $e){$failed=true;}
 qrr_scan_assert($failed,'Invalid input should be rejected');
}
$failed=false;try{qrr_thumbnail_path('../foo');}catch(RuntimeException $e){$failed=true;}
qrr_scan_assert($failed,'Path traversal should be rejected');
function qrr_scan_clean($path){if(is_dir($path)){foreach(scandir($path) as $x)if($x!=='.'&&$x!=='..')qrr_scan_clean($path.'/'.$x);rmdir($path);}elseif(is_file($path))unlink($path);}
qrr_scan_clean($root);
echo "QR unregistered-batch counts, JPEG validation and private thumbnail storage passed.\n";
