<?php
/** Dolibarr authorization and the explicit browser-facing inventory projection. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_internal_user($user) {
    return is_object($user) &&
        (int) ($user->id ?? 0) > 0 &&
        empty($user->socid) &&
        ((!isset($user->status) && !isset($user->statut)) ||
            (int) ($user->status ?? $user->statut) === 1);
}
function qrr_module_enabled() {
    if (!function_exists('isModEnabled')) {
        return false;
    }
    foreach (['qrrouter', 'product', 'stock', 'productbatch', 'binloc'] as $module) {
        if (!isModEnabled($module)) {
            return false;
        }
    }
    return true;
}
function qrr_stock_read_right($user) {
    return qrr_internal_user($user) && (!empty($user->admin) || $user->hasRight('stock', 'lire'));
}
function qrr_inventory_right($user) {
    return qrr_read_right($user) && qrr_products_right($user) && qrr_stock_read_right($user);
}
function qrr_locations_right($user) {
    return qrr_inventory_right($user) &&
        (!empty($user->admin) || $user->hasRight('binloc', 'read'));
}
function qrr_users_read_all($user) {
    return qrr_internal_user($user) &&
        (!empty($user->admin) ||
            $user->hasRight('user', 'user', 'read') ||
            $user->hasRight('user', 'user', 'lire'));
}
/** Dolibarr 24 adds an explicit read/write mode after the existing non-terminating flag. */
function qrr_native_read_access($user, $feature, $id, $table, $feature2 = '') {
    if (!function_exists('restrictedArea')) {
        return false;
    }
    $arguments = [$user, $feature, (int) $id, $table, $feature2, 'fk_soc', 'rowid', 0, 1];
    static $explicitMode = null;
    if ($explicitMode === null) {
        $explicitMode = (new ReflectionFunction('restrictedArea'))->getNumberOfParameters() >= 10;
    }
    if ($explicitMode) {
        $arguments[] = 'read';
    }
    return restrictedArea(...$arguments) > 0;
}
function qrr_user_visible($user, $id) {
    if (!qrr_internal_user($user) || (int) $id < 1) {
        return false;
    }
    if ((int) $id === (int) $user->id) {
        return true;
    }
    return qrr_users_read_all($user) && qrr_native_read_access($user, 'user', $id, 'user', 'user');
}
function qrr_reference_right($user, $type) {
    if (!qrr_inventory_right($user)) {
        return false;
    }
    $module =
        ['salesorder' => 'commande', 'production' => 'mrp', 'shipment' => 'expedition'][$type] ??
        '';
    if ($module === '' || !isModEnabled($module)) {
        return false;
    }
    return match ($type) {
        'salesorder' => qrr_orders_right($user),
        'production' => !empty($user->admin) || $user->hasRight('mrp', 'read'),
        'shipment' => !empty($user->admin) || $user->hasRight('expedition', 'lire'),
        default => false,
    };
}
function qrr_reference_visible($user, $type, $id) {
    if (!qrr_reference_right($user, $type) || (int) $id < 1 || !function_exists('restrictedArea')) {
        return false;
    }
    $feature = ['salesorder' => 'commande', 'production' => 'mrp', 'shipment' => 'expedition'][
        $type
    ];
    // Native object checks include entity sharing, customer assignments and subordinate visibility.
    return qrr_native_read_access($user, $feature, (int) $id, qrr_reference_schema($type), '');
}
function qrr_item_visible($db, $item, $warehouses = null, $products = null) {
    if (!is_array($item)) {
        return false;
    }
    $pid = (int) ($item['product_id'] ?? 0);
    $wid = (int) ($item['warehouse_id'] ?? 0);
    if ($pid > 0 && ($products !== null ? !isset($products[$pid]) : !qrr_product($db, $pid))) {
        return false;
    }
    if (!empty($item['product_lot_id'])) {
        try {
            qrr_native_lot($db, $item);
        } catch (Throwable $error) {
            return false;
        }
    }
    return $wid <= 0 || isset(($warehouses ?? qrr_warehouses($db))[$wid]);
}
function qrr_native_error($message, $detail) {
    dol_syslog('QR Router: ' . $message . ': ' . (string) $detail, LOG_ERR);
    return $message . '. Check server logs.';
}
function qrr_public_error($error) {
    if ($error instanceof Error) {
        dol_syslog('QR Router unexpected error: ' . $error->getMessage(), LOG_ERR);
        return 'QR Router could not complete this request. Check server logs.';
    }
    return $error->getMessage();
}
function qrr_require_item_visible($db, $item) {
    if (!qrr_item_visible($db, $item)) {
        throw new DomainException('QR item is inaccessible');
    }
}
/** Recovery must recheck both sides even when a previous native commit has a receipt. */
function qrr_require_native_visible($db, $pending) {
    $warehouses = qrr_warehouses($db);
    foreach ($pending['changes'] as $change) {
        foreach (['before', 'after'] as $side) {
            if ($change[$side] !== null && !qrr_item_visible($db, $change[$side], $warehouses)) {
                throw new DomainException('Native synchronization contains inaccessible QR items');
            }
        }
    }
}

/** Never serialize raw service snapshots, audit contexts, proofs or operation patches to clients. */
function qrr_browser_inventory($db) {
    global $user;
    if (!qrr_inventory_right($user)) {
        throw new DomainException('Missing Dolibarr permission');
    }
    $raw = qrr_service('GET', '');
    $products = qrr_products_index($db, array_column($raw['items'], 'product_id'));
    $warehouses = qrr_warehouses($db);
    $raw['items'] = array_filter(
        $raw['items'],
        fn($item) => qrr_item_visible($db, $item, $warehouses, $products),
    );
    foreach (qrr_native_observations($db, $raw) as $code => $fields) {
        $raw['items'][$code] = array_merge($raw['items'][$code], $fields);
    }
    $users = qrr_personal_users($db);
    $references = qrr_consumption_references($db, $user, $raw['items']);
    $fields = array_flip([
        'code',
        'type',
        'label',
        'product_id',
        'warehouse_id',
        'qty',
        'serial',
        'native_batch',
        'product_lot_id',
        'details',
        'created_at',
        'updated_at',
        'status',
        'consumed_units',
    ]);
    $state = [
        'schema' => (int) $raw['schema'],
        'revision' => (int) $raw['revision'],
        'items' => [],
        'batches' => [],
        'history' => [],
        'personal_warehouses' => [],
        'binloc_label_settings' => [],
    ];
    foreach ($raw['items'] as $code => $item) {
        if (!qrr_item_visible($db, $item, $warehouses, $products)) {
            continue;
        }
        $visible = array_intersect_key($item, $fields);
        $visible['bin'] = qrr_locations_right($user) ? (string) ($item['bin'] ?? '') : '';
        $visible['bin_key'] = qrr_locations_right($user) ? (string) ($item['bin_key'] ?? '') : '';
        $visible['bin_values'] = (object) (qrr_locations_right($user)
            ? (array) ($item['bin_values'] ?? [])
            : []);
        foreach (['pending_operation', 'pending_handoff'] as $key) {
            if (!empty($item[$key])) {
                $visible[$key] = array_intersect_key($item[$key], array_flip(['id', 'kind', 'at']));
            }
        }
        if (!empty($item['checkout'])) {
            $borrower = (int) ($item['checkout']['user_id'] ?? 0);
            $visible['checkout'] = (object) (isset($users[$borrower])
                ? array_intersect_key(
                    $item['checkout'],
                    array_flip(['user_id', 'reason', 'at', 'origin_warehouse_id']),
                )
                : []);
        }
        $visible['consumption_log'] = [];
        foreach ($item['consumption_log'] ?? [] as $entry) {
            $log = array_intersect_key(
                $entry,
                array_flip(['at', 'kind', 'quantity', 'reason', 'stock_posted']),
            );
            $type = (string) ($entry['reference_type'] ?? '');
            $id = (int) ($entry['reference_id'] ?? 0);
            if ($type !== '' && $id > 0) {
                if (isset($references[$type . ':' . $id])) {
                    $log['reference_type'] = $type;
                    $log['reference_id'] = $id;
                } else {
                    // Free text may repeat a restricted document's identity.
                    $log['reason'] = '';
                }
            }
            $visible['consumption_log'][] = $log;
        }
        $state['items'][$code] = $visible;
    }
    foreach ($raw['batches'] ?? [] as $id => $batch) {
        $codes = array_values(
            array_filter($batch['codes'] ?? [], fn($code) => isset($state['items'][$code])),
        );
        if ($codes) {
            $state['batches'][$id] = [
                'codes' => $codes,
                'type' => $batch['type'],
                'created_at' => $batch['created_at'],
            ];
        }
    }
    foreach ($raw['personal_warehouses'] ?? [] as $id => $wid) {
        if (isset($users[$id], $warehouses[$wid])) {
            $state['personal_warehouses'][$id] = (int) $wid;
        }
    }
    if (qrr_locations_right($user)) {
        foreach (
            array_intersect_key($raw['binloc_label_settings'] ?? [], $warehouses)
            as $wid => $settings
        ) {
            $state['binloc_label_settings'][$wid] = array_intersect_key(
                $settings,
                array_flip(['enabled', 'show', 'separator', 'show_warehouse']),
            );
        }
    }
    if (!empty($raw['pending_native'])) {
        $state['pending_native'] = array_intersect_key(
            $raw['pending_native'],
            array_flip(['id', 'action', 'at']),
        );
    }
    $productIds = array_column($state['items'], 'product_id');
    return [
        'state' => $state,
        'products' => array_intersect_key($products, array_flip($productIds)),
        'warehouses' => $warehouses,
        'users' => $users,
        'consumption_references' => $references,
    ];
}
