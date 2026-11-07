<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user))accessforbidden();
$code=qrr_input_code(GETPOST('code','alphanohtml'));$state=qrr_load_state();$item=$state['items'][$code] ?? null;
if(!$item){http_response_code(404);exit('Label not found');}
$img=qrr_link('qr.php',array('code'=>$code));
qrr_layout_start('Print QR label');
print '<div class="qrr-noprint"><button class="qrr-btn" onclick="window.print()">Print</button></div>';
print '<style>@page{size:A4;margin:8mm}.qrr-qr-label{border:1px dashed #888;width:65mm;min-height:65mm;padding:5mm;margin:15mm auto;text-align:center;box-sizing:border-box;background:white;color:black;font:12pt Arial}.qrr-qr-label img{width:40mm;height:40mm}.qrr-qr-label .qrr-printed-name{display:block;font-size:15pt;font-weight:700;overflow-wrap:anywhere}.qrr-qr-label .qrr-printed-code{display:block;font:9pt monospace;color:#555;overflow-wrap:anywhere}@media print{.qrr-qr-label{margin:0}}</style>';
print '<div class="qrr-qr-label"><span class="qrr-printed-name">'.qrr_h(qrr_item_display_name($item)).'</span><div><img src="'.qrr_h($img).'" alt="QR code"></div>'.(qrr_item_display_name($item)!==$code?'<small class="qrr-printed-code">QR '.qrr_h($code).'</small>':'').'</div>';
qrr_layout_end();
