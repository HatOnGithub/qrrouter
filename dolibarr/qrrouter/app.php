<?php
/** Angular host inside the authenticated Dolibarr shell. */
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    http_response_code(503);
    exit('Dolibarr bootstrap unavailable');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
if (!qrr_read_right($user) || !qrr_products_right($user)) {
    accessforbidden();
}
header('Cache-Control: no-store');
$index = __DIR__ . '/spa/index.html';
if (!is_file($index)) {
    http_response_code(503);
    qrr_page_header('QR Router');
    print '<p>QR Router frontend is not built. Run python tools/build-frontend.py before packaging the module.</p>';
    llxFooter();
    exit();
}
$markup = file_get_contents($index);
$base = dol_buildpath('/qrrouter/spa/', 1);
qrr_page_header('QR Router');
preg_match_all(
    '~<link\b[^>]*rel="stylesheet"[^>]*>|<script\b[^>]*src="[^"]+"[^>]*></script>~i',
    $markup,
    $tags,
);
$scripts = [];
foreach ($tags[0] as $tag) {
    $tag = preg_replace_callback(
        '~\b(src|href)="([^"]+)"~',
        function ($match) use ($base) {
            return $match[1] . '="' . qrr_h($base . $match[2]) . '"';
        },
        $tag,
    );
    if (stripos($tag, '<script') === 0) {
        $scripts[] = $tag;
    } else {
        print $tag;
    }
}
print '<qrr-root data-api="' . qrr_h(dol_buildpath('/qrrouter/api.php', 1)) . '"></qrr-root>';
print '<noscript>QR Router requires JavaScript.</noscript>' . implode("\n", $scripts);
llxFooter();
