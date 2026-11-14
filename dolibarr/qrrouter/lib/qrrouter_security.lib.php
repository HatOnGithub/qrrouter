<?php
/** Dolibarr authorization and the explicit browser-facing inventory projection. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

/** Base identity check precedes every admin shortcut: external/inactive users stay excluded. */
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
    foreach (['qrrouter', 'product', 'stock', 'productbatch'] as $module) {
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
/** Independent QR capabilities never replace Dolibarr's native permissions. */
function qrr_permission_keys() {
    return [
        'create',
        'modify',
        'delete',
        'move',
        'consume',
        'return',
        'adjust',
        'loans',
        'picking',
        'print',
        'recover',
        'manage',
    ];
}
function qrr_permission_right($user, $permission) {
    return qrr_inventory_right($user) &&
        (!empty($user->admin) || $user->hasRight('qrrouter', $permission));
}
/** Keep this public-action mapping aligned with C# OperationPermission and Angular can(). */
function qrr_operation_permission($action, $data = []) {
    return match ($action) {
        'create', 'bulk', 'register', 'physical-bin-create' => 'create',
        'update', 'physical-bin-assign' => 'modify',
        'delete-unassigned' => 'delete',
        'physical-bin-move' => 'move',
        'count', 'box-transfer' => 'adjust',
        'pick-list-save', 'pick-list-complete' => 'picking',
        'native-recover', 'native-cancel', 'reconcile' => 'recover',
        'mapping', 'label-settings', 'location-configure', 'location-import' => 'manage',
        'workflow' => match ($data['kind'] ?? '') {
            'move' => 'move',
            'consume' => 'consume',
            'return' => 'return',
            'correct', 'transfer' => 'adjust',
            'checkout', 'checkin' => 'loans',
            default => '',
        },
        default => '',
    };
}
function qrr_require_operation_right($user, $action, $data = []) {
    $permission = qrr_operation_permission($action, $data);
    if ($permission !== '' && !qrr_permission_right($user, $permission)) {
        throw new DomainException('Missing QR Router ' . $permission . ' permission');
    }
}
function qrr_locations_right($user) {
    return qrr_inventory_right($user);
}
function qrr_history_right($user) {
    return qrr_inventory_right($user) &&
        (!empty($user->admin) || $user->hasRight('stock', 'mouvement', 'lire')) &&
        (!empty($user->admin) || $user->hasRight('qrrouter', 'history'));
}
/** A history grant does not expose products, warehouses or documents hidden natively. */
function qrr_history_visibility($db) {
    $view = qrr_browser_inventory($db);
    $state = qrr_service('GET', '');
    $references = array_keys($view['consumption_references']);
    foreach ($state['pick_lists'] ?? [] as $list) {
        if (qrr_reference_visible($GLOBALS['user'], 'salesorder', (int) $list['order_id'])) {
            $references[] = 'salesorder:' . (int) $list['order_id'];
        }
    }
    return [
        'codes' => qrr_item_codes($view['state']['items']),
        'warehouses' => array_map('intval', array_keys($view['warehouses'])),
        'bins' => array_column(qrr_physical_bins($db), 'id'),
        'references' => array_values(array_unique($references)),
    ];
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
/** Broad read grants alone are insufficient: validate the product, linked lot and warehouse. */
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

/**
 * Describe known public fields only after checking both sides of a change. The result contains
 * display rows, not the original candidate snapshot; intended values are not commit evidence.
 */
function qrr_pending_change_details($db, $code, $before, $after, $warehouses, $products) {
    foreach ([$before, $after] as $side) {
        if ($side !== null && !qrr_item_visible($db, $side, $warehouses)) {
            return [];
        }
    }
    $fields = [
        'label' => 'Label',
        'type' => 'Type',
        'product_id' => 'Product',
        'warehouse_id' => 'Warehouse',
        'qty' => 'Quantity',
        'serial' => 'Serial',
        'native_batch' => 'Lot / serial',
        'status' => 'Status',
    ];
    if (qrr_locations_right($GLOBALS['user'])) {
        $fields['bin'] = 'Location';
    }
    $rows = [];
    foreach ($fields as $key => $label) {
        $values = [];
        foreach ([$before, $after] as $side) {
            $value = $side[$key] ?? null;
            if ($key === 'warehouse_id' && $value > 0) {
                $value = $warehouses[$value]['ref'];
            } elseif ($key === 'product_id' && $value > 0) {
                $value = $products[$value]['ref'] ?? qrr_product($db, $value)->ref;
            }
            $values[] = is_scalar($value) && $value !== '' ? (string) $value : null;
        }
        if ($values[0] !== $values[1]) {
            $rows[] = [
                'code' => (string) $code,
                'field' => $label,
                'before' => $values[0],
                'after' => $values[1],
            ];
        }
    }
    return $rows;
}
/**
 * Summarize the allowed patch and signed warehouse deltas without exposing raw effects/proofs.
 * A hidden destination/effect warehouse suppresses the details instead of leaking its identity.
 */
function qrr_pending_operation_details($db, $item, $pending, $warehouses, $products) {
    $after = array_merge($item, (array) ($pending['patch'] ?? []));
    if (!empty($pending['to'])) {
        $after['warehouse_id'] = (int) $pending['to'];
    }
    foreach ($pending['effects'] ?? [] as $effect) {
        if (!empty($effect['warehouse_id']) && !isset($warehouses[$effect['warehouse_id']])) {
            return [];
        }
    }
    if (!qrr_item_visible($db, $after, $warehouses)) {
        return [];
    }
    $rows = qrr_pending_change_details($db, $item['code'], $item, $after, $warehouses, $products);
    foreach ($pending['effects'] ?? [] as $effect) {
        $wid = (int) ($effect['warehouse_id'] ?? 0);
        $delta = $effect['delta'] ?? 0;
        if (isset($warehouses[$wid]) && is_numeric($delta) && $delta != 0) {
            $rows[] = [
                'code' => $item['code'],
                'field' => 'Stock movement',
                'before' => null,
                'after' => ($delta > 0 ? '+' : '') . $delta . ' (' . $warehouses[$wid]['ref'] . ')',
            ];
        }
    }
    return $rows;
}

/**
 * Sole full-inventory browser projection: overlay native observations, apply object visibility
 * and select safe fields. Never serialize raw snapshots, audit contexts, proofs or patches.
 * Catalogs, checkout users and document-linked consumption are filtered separately below.
 */
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
        $item = $raw['items'][$code];
        if (
            empty($item['pending_bin_move']) &&
            ((int) $item['warehouse_id'] !== (int) $fields['warehouse_id'] ||
                (string) $item['bin_key'] !== (string) $fields['bin_key'] ||
                $fields['status'] === 'consumed')
        ) {
            unset($raw['items'][$code]['physical_bin_id']);
        }
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
        'physical_bin_id',
        'pending_bin_move',
    ]);
    $state = [
        'schema' => (int) $raw['schema'],
        'revision' => (int) $raw['revision'],
        'items' => [],
        'batches' => [],
        'history' => [],
        'personal_warehouses' => [],
        'location_label_settings' => [],
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
                $visible[$key]['details'] = qrr_pending_operation_details(
                    $db,
                    $item,
                    $item[$key],
                    $warehouses,
                    $products,
                );
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
            array_intersect_key($raw['location_label_settings'] ?? [], $warehouses)
            as $wid => $settings
        ) {
            $state['location_label_settings'][$wid] = array_intersect_key(
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
        $details = [];
        foreach ($raw['pending_native']['changes'] ?? [] as $code => $change) {
            $details = array_merge(
                $details,
                qrr_pending_change_details(
                    $db,
                    $code,
                    $change['before'] ?? null,
                    $change['after'] ?? null,
                    $warehouses,
                    $products,
                ),
            );
        }
        if ($details) {
            $details[] = [
                'code' => '',
                'field' => 'Native synchronization',
                'before' => null,
                'after' => !empty($raw['pending_native']['link_existing'])
                    ? 'Link existing stock'
                    : 'Apply stock changes',
            ];
        }
        $state['pending_native']['details'] = $details;
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
