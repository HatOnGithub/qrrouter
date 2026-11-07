<?php
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user))accessforbidden();
$mode=(string)GETPOST('mode','alphanohtml');$from=qrr_input_code(GETPOST('from','alphanohtml'));
if($mode!=='boxdest'){$mode='';$from='';}
if($mode==='boxdest'){
    if(!qrr_write_right($user))accessforbidden();
    $st=qrr_load_state();$source=$st['items'][$from]??null;
    if(!$source||$source['type']!=='box')accessforbidden('Scan a registered source container first');
}
$value=qrr_input_code(GETPOST('code','alphanohtml'));
if($value!==''){
    if(!qrr_code_valid($value))accessforbidden('Invalid QR identifier format');
    header('Location: '.($mode==='boxdest'?qrr_link('transfer.php',array('from'=>$from,'to'=>$value)):qrr_link('scan.php',array('code'=>$value))));exit;
}
qrr_layout_start($mode==='boxdest'?'Scan destination container':'Scan QR code');
print '<div class="qrr-panel"><p>'.($mode==='boxdest'?'Source container <strong>'.qrr_h(qrr_item_display_name($source)).'</strong>'.(qrr_item_display_name($source)!==$from?' (QR '.qrr_h($from).')':'').' is selected. Scan the <strong>destination container</strong> and then enter the quantity to transfer.':'Scan a QR label using your phone camera. Each QR encodes only the short identifier, not a URL or product information.').'</p>';
print '<div class="qrr-camera-stage" id="qrr-camera-stage"><video id="qrr-video" autoplay playsinline muted></video><div class="qrr-camera-placeholder">Opening camera…</div></div>';
print '<div class="qrr-camera-controls"><button type="button" class="qrr-btn" id="qrr-start">Restart camera</button><button type="button" class="qrr-btn alt" id="qrr-stop">Stop camera</button><a class="qrr-btn alt" href="'.qrr_h(qrr_link('manual.php',array('intent'=>$mode==='boxdest'?'boxdest':'lookup','from'=>$from))).'">Enter codes manually</a></div><p id="qrr-status" class="qrr-small" role="status"></p>';
print '<form id="qrr-manual" action="'.qrr_h(qrr_link('camera.php')).'" method="get"><input type="hidden" id="qrr-code" name="code" value="">';
if($mode==='boxdest')print '<input type="hidden" name="mode" value="boxdest"><input type="hidden" name="from" value="'.qrr_h($from).'">';
print '</form><p class="qrr-small">The camera starts automatically when supported. If permission is denied, use Restart camera or Enter codes manually. HTTPS and camera permission are required.</p></div>';
if(is_file(__DIR__.'/assets/vendor/jsQR.js')) print '<script>window.QRR_JSQR_URL='.json_encode(qrr_base().'assets/vendor/jsQR.js',JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';</script>';
print '<script src="'.qrr_h(qrr_base().'assets/camera-decoder.js?v=2.6.14').'" defer></script>';
print '<script src="'.qrr_h(qrr_base().'assets/code.js?v=2.6.14').'" defer></script>';
print '<script src="'.qrr_h(qrr_base().'assets/camera-page.js?v=2.6.14').'" defer></script>';
qrr_layout_end();
