<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user))accessforbidden();
$batch=strtoupper(trim((string)GETPOST('batch','alphanohtml')));
$state=qrr_load_state();$row=$state['batches'][$batch]??null;
$onlyUnassigned=(int)GETPOST('unassigned','int')===1;
if(!$row){http_response_code(404);exit('QR batch not found');}
$printCodes=array_values(array_filter((array)$row['codes'],function($code)use($state,$onlyUnassigned){
 return isset($state['items'][$code]) && (!$onlyUnassigned || ($state['items'][$code]['type']??'')==='unassigned');
}));
qrr_layout_start('Printable QR batch');
print '<div class="qrr-noprint"><p>Batch '.qrr_h($batch).' — '.count($printCodes).' '.($onlyUnassigned?'remaining unassigned':'total').' labels. Printing does not change native stock.</p>';
if($printCodes)print '<button class="qrr-btn" onclick="window.print()">Print / Save as PDF</button> ';
print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('batches.php')).'">Back to unregistered QR batches</a> <a class="qrr-btn alt" href="'.qrr_h(qrr_link('register.php')).'">Go to registration</a></div>';
if(!$printCodes)print '<div class="qrr-panel">There are no unassigned labels remaining in this batch.</div>';
print '<style>@page{size:A4;margin:7mm}.qrr-batch{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.qrr-batchlabel{box-sizing:border-box;border:1px dashed #aaa;text-align:center;background:#fff;color:#000;height:42mm;padding:2mm;break-inside:avoid;font:10pt Arial}.qrr-batchlabel img{width:29mm;height:29mm;object-fit:contain}.qrr-batchlabel strong{display:block;font:700 11pt monospace;letter-spacing:.5px}.qrr-batchlabel small{display:none}@media print{.qrr-batchlabel{margin:0}}</style><div class="qrr-batch">';
foreach($printCodes as $code){$img=qrr_link('qr.php',array('code'=>$code));print '<div class="qrr-batchlabel"><img src="'.qrr_h($img).'" alt="QR"><strong>'.qrr_h($code).'</strong></div>';}
print '</div>';qrr_layout_end();
