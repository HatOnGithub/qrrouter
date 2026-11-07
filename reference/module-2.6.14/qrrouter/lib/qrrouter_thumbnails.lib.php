<?php
/** Optional camera-scan thumbnails. Stored outside the web root; never as JSON data. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

/** Decodes only small camera-created JPEG data URIs. Returns null when none was supplied. */
function qrr_thumbnail_decode($data) {
    if ($data === '' || $data === null) return null;
    if (!is_string($data) || strlen($data) > 105000 || !preg_match('~^data:image/jpeg;base64,([A-Za-z0-9+/]+={0,2})$~D', $data, $m)) {
        throw new RuntimeException('Invalid scan thumbnail');
    }
    $bytes = base64_decode($m[1], true);
    if ($bytes === false || strlen($bytes) < 100 || strlen($bytes) > 75000) throw new RuntimeException('Scan thumbnail is too large or invalid');
    $size = @getimagesizefromstring($bytes);
    if (!$size || $size[2] !== IMAGETYPE_JPEG || $size[0] < 16 || $size[1] < 16 || $size[0] > 256 || $size[1] > 256) {
        throw new RuntimeException('Scan thumbnail must be a small JPEG image');
    }
    return $bytes;
}
function qrr_thumbnail_path($code) {
    if (!qrr_code_valid($code)) throw new RuntimeException('Invalid QR identifier');
    return qrr_data_dir().'/thumbnails/'.$code.'.jpg';
}
/** Only call with already validated JPEG bytes and an existing, registered QR. */
function qrr_thumbnail_store($code, $bytes) {
    $target=qrr_thumbnail_path($code);
    $dir=dirname($target);
    if (!is_dir($dir) && !@mkdir($dir,0700,true) && !is_dir($dir)) throw new RuntimeException('Cannot create thumbnail directory');
    $tmp=tempnam($dir,'.scan-');
    if ($tmp===false) throw new RuntimeException('Cannot create thumbnail file');
    try {
        if (file_put_contents($tmp,$bytes,LOCK_EX)!==strlen($bytes)) throw new RuntimeException('Cannot save scan thumbnail');
        @chmod($tmp,0600);
        if (!rename($tmp,$target)) throw new RuntimeException('Cannot commit scan thumbnail');
    } finally { if (is_file($tmp)) @unlink($tmp); }
}
function qrr_thumbnail_exists($code) {
    return qrr_code_valid($code) && is_file(qrr_thumbnail_path($code));
}
function qrr_thumbnail_url($code) {
    return qrr_link(qrr_thumbnail_exists($code)?'thumbnail.php':'qr.php',array('code'=>$code));
}
