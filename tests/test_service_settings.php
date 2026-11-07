<?php
/** Service settings validation without a Dolibarr instance or real credentials. */
define('DOL_DOCUMENT_ROOT', __DIR__);
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter_service.lib.php';

$checks = 0;
$key = str_repeat('a', 64);
foreach (
    ['http://127.0.0.1:5087', 'http://qrrouter-api:8080', 'https://service.example/qrrouter']
    as $url
) {
    $settings = qrr_validate_service_settings($url . '/', $key);
    if ($settings !== ['url' => $url, 'key' => $key]) {
        throw new RuntimeException('Valid URL was not normalized correctly');
    }
    $checks++;
}
foreach (
    [
        '',
        'file:///etc/passwd',
        'ftp://service.example',
        'http://user:pass@service.example',
        'http://user@service.example',
        'https://service.example?key=secret',
        'https://service.example#fragment',
        "http://service.example\r\nX-Forged: true",
    ]
    as $url
) {
    try {
        qrr_validate_service_settings($url, $key);
    } catch (InvalidArgumentException $error) {
        $checks++;
        continue;
    }
    throw new RuntimeException('Invalid service URL was accepted');
}
foreach (
    ['', str_repeat('a', 31), str_repeat('a', 513), $key . "\r\n", $key . ' with spaces']
    as $invalidKey
) {
    try {
        qrr_validate_service_settings('http://qrrouter-api:8080', $invalidKey);
    } catch (InvalidArgumentException $error) {
        $checks++;
        continue;
    }
    throw new RuntimeException('Invalid API key was accepted');
}
$conf = (object) [
    'global' => (object) [
        'QRR_SERVICE_URL' => 'http://qrrouter-api:8080',
        'QRR_SERVICE_API_KEY' => $key,
    ],
];
if (qrr_service_settings()['key'] !== $key) {
    throw new RuntimeException('Module configuration was not read');
}
$checks++;
unset($conf->global->QRR_SERVICE_API_KEY);
try {
    qrr_service_settings();
    throw new LogicException('Missing module settings were accepted');
} catch (RuntimeException $error) {
    if (strpos($error->getMessage(), 'module settings') === false) {
        throw $error;
    }
    $checks++;
}
print 'Passed ' . $checks . " service settings checks.\n";
