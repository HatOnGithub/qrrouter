<?php
/** Server-to-server integration. The browser never sees the API key or identity headers. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_validate_service_settings($url, $key) {
    $base = rtrim(trim((string) $url), '/');
    $parts = parse_url($base);
    if (
        strlen($base) > 2048 ||
        filter_var($base, FILTER_VALIDATE_URL) === false ||
        !is_array($parts) ||
        !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) ||
        empty($parts['host']) ||
        isset($parts['user']) ||
        isset($parts['pass']) ||
        isset($parts['query']) ||
        isset($parts['fragment']) ||
        preg_match('/[\s\x00-\x1f\x7f]/', $base)
    ) {
        throw new InvalidArgumentException(
            'Enter a valid HTTP or HTTPS service URL without credentials, a query or a fragment.',
        );
    }
    if (strlen($key) < 32 || strlen($key) > 512 || preg_match('/[^\x21-\x7e]/', $key)) {
        throw new InvalidArgumentException(
            'The service API key must contain 32 to 512 printable characters without spaces.',
        );
    }
    return ['url' => $base, 'key' => $key];
}

function qrr_service_settings() {
    global $conf;
    try {
        return qrr_validate_service_settings(
            (string) ($conf->global->QRR_SERVICE_URL ?? ''),
            (string) ($conf->global->QRR_SERVICE_API_KEY ?? ''),
        );
    } catch (InvalidArgumentException $error) {
        throw new RuntimeException(
            'Configure the service URL and API key in the QR Router module settings.',
        );
    }
}

function qrr_service($method, $action, $data = null) {
    global $user, $conf;
    $settings = qrr_service_settings();
    $base = $settings['url'];
    $key = $settings['key'];
    if (!function_exists('curl_init')) {
        throw new RuntimeException('QR Router requires PHP cURL.');
    }
    $headers = [
        'Content-Type: application/json',
        'X-Api-Key: ' . $key,
        'X-Qrr-Entity: ' . (int) $conf->entity,
        'X-Qrr-User: ' . (int) $user->id,
        'X-Qrr-Read: ' . (qrr_read_right($user) ? '1' : '0'),
        'X-Qrr-Manage: ' . (qrr_write_right($user) ? '1' : '0'),
        'X-Qrr-Stock: ' . (qrr_stock_write_right($user) ? '1' : '0'),
        'X-Qrr-Admin: ' . (!empty($user->admin) ? '1' : '0'),
    ];
    $handle = curl_init(
        $base . '/api/inventory' . ($action !== '' ? '/' . rawurlencode($action) : ''),
    );
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    ]);
    if ($data !== null) {
        curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode((object) $data, JSON_THROW_ON_ERROR));
    }
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    curl_close($handle);
    if ($body === false || $status === 0) {
        throw new RuntimeException(
            'QR service unavailable. Do not repeat a stock action; check pending operations when it reconnects.',
        );
    }
    $result = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    if ($status < 200 || $status >= 300) {
        if ($status === 400) {
            throw new InvalidArgumentException($result['message'] ?? 'Invalid QR request');
        }
        if ($status === 403) {
            throw new DomainException($result['message'] ?? 'Missing Dolibarr permission');
        }
        throw new RuntimeException($result['message'] ?? 'QR service rejected the request');
    }
    return $action === '' ? $result : $result['result'] ?? null;
}
function qrr_command($action, $data) {
    global $db;
    if (!in_array($action, ['native-finish', 'native-cancel'], true)) {
        $state = qrr_service('GET', '');
        if (!empty($state['pending_native']) && !str_starts_with($action, 'query-')) {
            throw new RuntimeException('Complete the pending Dolibarr synchronization first');
        }
        $data['native_items'] = (object) qrr_native_observations($db, $state);
    }
    return qrr_service('POST', $action, $data);
}

/** Dolibarr supplies trusted native product/warehouse facts; C# validates QR domain rules. */
function qrr_service_fields(
    $type,
    $label,
    $pid,
    $wid,
    $choice,
    $qty,
    $details = '',
    $serial = '',
    $nativeBatch = ''
) {
    global $db, $user;
    if ($pid) {
        $product = qrr_products_right($user) ? qrr_product($db, $pid) : null;
        if (!$product || (int) $product->type !== 0) {
            throw new RuntimeException('Physical product inaccessible');
        }
        if (
            isset($product->entity) &&
            !in_array(
                (int) $product->entity,
                array_map('intval', explode(',', getEntity('product'))),
                true,
            )
        ) {
            throw new RuntimeException('Product outside accessible entities');
        }
    }
    return [
        'type' => $type,
        'label' => $label,
        'product_id' => $pid,
        'warehouse_id' => $wid,
        'choice' => $choice,
        'qty' => $qty,
        'details' => $details,
        'serial' => $serial,
        'native_batch' => $nativeBatch,
        'warehouses' => (object) qrr_warehouses($db),
    ];
}

/** Older Dolibarr fetches populate statut while newer releases also expose status. */
function qrr_warehouse_closed($warehouse) {
    return (int) ($warehouse->statut ?? ($warehouse->status ?? Entrepot::STATUS_CLOSED)) ===
        (int) Entrepot::STATUS_CLOSED;
}

/** Integration preflight before durable staging; native execution repeats checks before writing. */
function qrr_service_preflight($db, $user, $entry, $plan) {
    if (!empty($entry['product_lot_id'])) {
        qrr_native_rights($user);
    }
    if (empty($plan['effects'])) {
        return;
    }
    if (!qrr_stock_write_right($user)) {
        throw new RuntimeException('Stock movement permission required');
    }
    $product = qrr_product($db, (int) $plan['product_id']);
    if (!$product || (int) $product->type !== 0) {
        throw new RuntimeException('Physical Dolibarr product required');
    }
    if ($product->hasbatch() && empty($entry['native_batch'])) {
        throw new RuntimeException('Native lot/serial required');
    }
    require_once DOL_DOCUMENT_ROOT . '/product/stock/class/entrepot.class.php';
    foreach ($plan['effects'] as $effect) {
        $wid = (int) $effect['warehouse_id'];
        $w = new Entrepot($db);
        if ($w->fetch($wid) <= 0 || qrr_warehouse_closed($w)) {
            throw new RuntimeException('Warehouse missing or closed');
        }
        if ($effect['delta'] < 0) {
            if (qrr_stock_qty($db, (int) $product->id, $wid) + 0.00001 < -$effect['delta']) {
                throw new RuntimeException('Insufficient native stock');
            }
            qrr_native_batch($db, $product, $entry, $wid, -(int) $effect['delta']);
        }
    }
}
