<?php
/** Same-origin Angular gateway. All native facts and service identities come from Dolibarr. */
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    http_response_code(503);
    exit('Dolibarr bootstrap unavailable');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
require_once __DIR__ . '/lib/qrrouter_labels.lib.php';
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function qrr_api_permit($allowed) {
    if (!$allowed) {
        throw new DomainException('Missing Dolibarr permission');
    }
}
function qrr_api_int($data, $key, $default = 0) {
    $value = $data[$key] ?? $default;
    if (filter_var($value, FILTER_VALIDATE_INT) === false) {
        throw new InvalidArgumentException('Invalid ' . $key);
    }
    return (int) $value;
}
function qrr_api_fields($data, $existing = null) {
    global $db, $user;
    $type = (string) ($data['type'] ?? 'generic');
    $pid = qrr_api_int($data, 'product_id');
    $wid = qrr_api_int($data, 'warehouse_id');
    $qty =
        $type === 'box'
            ? (($data['qty'] ?? null) === null
                ? null
                : qrr_api_int($data, 'qty'))
            : ($type === 'unassigned'
                ? 0
                : 1);
    $choice = qrr_binloc_choice(
        $db,
        $wid,
        $data['levels'] ?? [],
        $existing,
        !empty($data['keep_legacy']),
    );
    $label = trim(strip_tags((string) ($data['label'] ?? '')));
    $serial = trim(strip_tags((string) ($data['serial'] ?? '')));
    if ($type === 'tracked' && $serial === '') {
        if (!empty($existing['product_lot_id'])) {
            $serial = (string) $existing['serial'];
        } else {
            $serial = qrr_native_generate_serial($db, $pid, $label);
        }
    }
    $nativeBatch = $type === 'box' ? $label : ($type === 'tracked' ? $serial : '');
    if (
        in_array($type, ['box', 'tracked'], true) &&
        ($nativeBatch === '' || strlen($nativeBatch) > 100)
    ) {
        throw new InvalidArgumentException(
            'Enter a serial number or box name of at most 100 bytes',
        );
    }
    return qrr_service_fields(
        $type,
        $label,
        $pid,
        $wid,
        $choice,
        $qty,
        trim(strip_tags((string) ($data['details'] ?? ''))),
        $serial,
        $nativeBatch,
    );
}
function qrr_api_translations() {
    global $langs;
    $result = [];
    if (isset($langs) && is_object($langs) && method_exists($langs, 'load')) {
        $langs->load('qrrouter@qrrouter');
    }
    foreach (file(__DIR__ . '/langs/en_US/qrrouter.lang', FILE_IGNORE_NEW_LINES) as $line) {
        if (!preg_match('/^(QRRUI_[^=]+)=(.*)$/', $line, $m)) {
            continue;
        }
        $english = qrr_plain_translation($m[2]);
        $result[$english] = qrr_translation_text($m[1], $m[2]);
    }
    $locale = substr((string) ($langs->defaultlang ?? 'en_US'), 0, 2);
    $extra = __DIR__ . '/langs/' . $locale . '.spa.json';
    if (is_file($extra)) {
        $result = array_merge(
            $result,
            array_map(
                'qrr_plain_translation',
                json_decode(file_get_contents($extra), true, 512, JSON_THROW_ON_ERROR),
            ),
        );
    }
    return (object) $result;
}
function qrr_api_get($resource) {
    global $db, $user, $langs;
    if ($resource === 'bootstrap') {
        $state = qrr_load_state();
        $products = qrr_products_index($db, array_column($state['items'], 'product_id'));
        foreach (['items', 'batches', 'personal_warehouses', 'binloc_label_settings'] as $map) {
            $state[$map] = (object) ($state[$map] ?? []);
        }
        return [
            'state' => $state,
            'label_formats' => qrr_label_profiles(),
            'warehouses' => (object) qrr_warehouses($db),
            'users' => (object) (qrr_write_right($user) ? qrr_personal_users($db) : []),
            'products' => (object) $products,
            'permissions' => [
                'manage' => qrr_write_right($user),
                'stock' => qrr_stock_write_right($user),
                'admin' => !empty($user->admin),
                'orders' => qrr_orders_right($user),
            ],
            'csrf' => qrr_token(),
            'token' => newToken(),
            'locale' => (string) ($langs->defaultlang ?? 'en_US'),
            'translations' => qrr_api_translations(),
        ];
    }
    if ($resource === 'serial-check') {
        qrr_api_permit(qrr_write_right($user));
        $serial = trim((string) GETPOST('serial', 'alphanohtml'));
        if ($serial === '' || strlen($serial) > 100) {
            throw new InvalidArgumentException('Enter a serial number of at most 100 bytes');
        }
        $pid = (int) GETPOST('product_id', 'int');
        $exists = qrr_native_serial_exists($db, $pid, $serial);
        $associated = false;
        if ($exists) {
            foreach (qrr_load_state()['items'] as $item) {
                if (
                    (int) $item['product_id'] === $pid &&
                    strcasecmp((string) ($item['native_batch'] ?? ''), $serial) === 0
                ) {
                    $associated = true;
                    break;
                }
            }
        }
        return ['exists' => $exists, 'associated' => $associated];
    }
    if ($resource === 'levels') {
        $wid = (int) GETPOST('warehouse_id', 'int');
        $warehouses = qrr_warehouses($db);
        if (!isset($warehouses[$wid])) {
            throw new InvalidArgumentException('Unknown warehouse');
        }
        $out = [];
        foreach (qrr_binloc_levels($db, $wid) as $id => $cfg) {
            $options = [];
            foreach ($cfg->options ?? [] as $option) {
                if ((int) $option->active === 1) {
                    $options[] = ['id' => (int) $option->id, 'value' => (string) $option->value];
                }
            }
            $out[] = [
                'id' => (int) $id,
                'label' => (string) $cfg->label,
                'datatype' => (string) $cfg->datatype,
                'options' => $options,
            ];
        }
        return $out;
    }
    $q = trim((string) GETPOST('q', 'alphanohtml'));
    if (strlen($q) > 100) {
        throw new InvalidArgumentException('Search is too long');
    }
    if ($resource === 'products') {
        $sql =
            'SELECT rowid,ref,label FROM ' .
            MAIN_DB_PREFIX .
            'product WHERE entity IN (' .
            getEntity('product') .
            ') AND fk_product_type=0';
        if ($q !== '') {
            $sql .=
                " AND (ref LIKE '%" .
                $db->escape($q) .
                "%' OR label LIKE '%" .
                $db->escape($q) .
                "%')";
        }
        $sql .= ' ORDER BY ref LIMIT 50';
    } elseif ($resource === 'orders') {
        qrr_api_permit(qrr_orders_right($user));
        $sql =
            'SELECT c.rowid,c.ref,s.nom AS customer FROM ' .
            MAIN_DB_PREFIX .
            'commande c LEFT JOIN ' .
            MAIN_DB_PREFIX .
            'societe s ON s.rowid=c.fk_soc WHERE c.entity IN (' .
            getEntity('commande') .
            ')';
        if ($q !== '') {
            $sql .=
                " AND (c.ref LIKE '%" .
                $db->escape($q) .
                "%' OR s.nom LIKE '%" .
                $db->escape($q) .
                "%')";
        }
        $sql .= ' ORDER BY c.rowid DESC LIMIT 50';
    } elseif ($resource === 'references') {
        qrr_api_permit(qrr_write_right($user));
        $type = (string) GETPOST('type', 'alphanohtml');
        $schema = qrr_reference_schema($type);
        qrr_api_permit(
            !empty($user->admin) ||
                ($type === 'salesorder'
                    ? qrr_orders_right($user)
                    : ($type === 'production'
                        ? $user->hasRight('mrp', 'read')
                        : $user->hasRight('expedition', 'lire'))),
        );
        $sql =
            'SELECT rowid,ref FROM ' .
            MAIN_DB_PREFIX .
            $schema .
            ' WHERE entity=' .
            (int) $GLOBALS['conf']->entity;
        if ($q !== '') {
            $sql .= " AND ref LIKE '%" . $db->escape($q) . "%'";
        }
        $sql .= ' ORDER BY rowid DESC LIMIT 100';
    } elseif ($resource === 'locations') {
        $wid = (int) GETPOST('warehouse_id', 'int');
        $warehouses = qrr_warehouses($db);
        if (!isset($warehouses[$wid])) {
            throw new InvalidArgumentException('Unknown warehouse');
        }
        $bin = (string) GETPOST('bin', 'alphanohtml');
        $state = qrr_load_state();
        $products = qrr_products_index($db, array_column($state['items'], 'product_id'));
        return [
            'bins' => qrr_known_bins($state['items'], $wid),
            'summary' => qrr_bin_summary($state['items'], $wid, $bin, $products),
            'qr' => qrr_warehouse_summary($state['items'], $wid),
            'native' => (object) qrr_stock_totals($db, array_keys($products)),
        ];
    } elseif ($resource === 'picking') {
        qrr_api_permit(qrr_orders_right($user));
        $wid = (int) GETPOST('warehouse_id', 'int');
        $warehouses = qrr_warehouses($db);
        if (!isset($warehouses[$wid])) {
            throw new InvalidArgumentException('Unknown warehouse');
        }
        $order = qrr_order_lines($db, (int) GETPOST('order_id', 'int'));
        $state = qrr_load_state();
        $products = qrr_products_index($db, array_column($order['lines'], 'product_id'));
        return qrr_pick_proposal($order['lines'], $state['items'], $wid, $products);
    } else {
        throw new InvalidArgumentException('Unknown resource');
    }
    $rs = $db->query($sql);
    if (!$rs) {
        throw new RuntimeException('Dolibarr lookup unavailable');
    }
    $out = [];
    while ($row = $db->fetch_object($rs)) {
        $out[] = [
            'id' => (int) $row->rowid,
            'text' =>
                (string) $row->ref .
                (isset($row->label)
                    ? ' — ' . $row->label
                    : (isset($row->customer)
                        ? ' — ' . $row->customer
                        : '')),
        ];
    }
    $db->free($rs);
    return $out;
}
function qrr_api_post($action, $data) {
    global $db, $user;
    qrr_api_permit(qrr_write_right($user));
    if (in_array($action, ['native-recover', 'native-cancel'], true)) {
        $pending = qrr_service('GET', '')['pending_native'] ?? null;
        if (!$pending) {
            throw new InvalidArgumentException('No pending synchronization');
        }
        if (time() - strtotime($pending['at']) < 30) {
            throw new RuntimeException(
                'Synchronization may still be running; wait 30 seconds before recovery',
            );
        }
        return $action === 'native-cancel'
            ? qrr_native_cancel($db, $user, $pending)
            : qrr_native_complete($db, $user, $pending);
    }
    // Never forward the browser's object wholesale to the C# service.
    if (in_array($action, ['create', 'update', 'bulk', 'register'], true)) {
        $code = qrr_input_code($data['code'] ?? '');
        $existing = null;
        if ($action === 'update') {
            $existing = qrr_load_state()['items'][$code] ?? null;
        }
        $fields = qrr_api_fields($data, $existing);
        if ($action === 'update') {
            $fields['code'] = $code;
        }
        if ($action === 'bulk') {
            $fields['count'] = qrr_api_int($data, 'count');
        }
        if ($action === 'register') {
            $codes = qrr_workflow_codes($data['codes'] ?? []);
            $posted = [
                'label' => $fields['label'],
                'product_id' => $fields['product_id'],
                'warehouse_id' => $fields['warehouse_id'],
                'qty' => $fields['qty'],
                'serial' => $fields['serial'],
                'details' => $fields['details'],
                'native_batch' => $fields['native_batch'],
                'qrr_levels' => $data['levels'] ?? [],
            ];
            $validated = qrr_registration_fields(
                $db,
                $user,
                $posted,
                qrr_warehouses($db),
                $fields['type'],
            );
            $bytes =
                $fields['type'] === 'tracked'
                    ? qrr_thumbnail_decode($data['thumbnail'] ?? null)
                    : null;
            $registered = qrr_register_codes($db, $user, $codes, $fields['type'], $validated);
            $warning = '';
            if ($bytes !== null) {
                try {
                    qrr_thumbnail_store($registered[0], $bytes);
                } catch (Throwable $e) {
                    $warning = 'Registration saved, but the thumbnail could not be stored.';
                }
            }
            return ['codes' => $registered, 'warning' => $warning];
        }
        return in_array($fields['type'], ['tracked', 'box'], true)
            ? qrr_native_command($db, $user, $action, $fields)
            : qrr_command($action, $fields);
    }
    if ($action === 'count') {
        $fields = [
            'code' => qrr_input_code($data['code'] ?? ''),
            'quantity' => qrr_api_int($data, 'quantity', -1),
            'reason' => (string) ($data['reason'] ?? ''),
        ];
        $item = qrr_load_state()['items'][$fields['code']] ?? null;
        return !empty($item['product_lot_id'])
            ? qrr_native_command($db, $user, 'count', $fields)
            : qrr_command('count', $fields);
    }
    if ($action === 'box-transfer') {
        $fields = [
            'from' => qrr_input_code($data['from'] ?? ''),
            'to' => qrr_input_code($data['to'] ?? ''),
            'quantity' => qrr_api_int($data, 'quantity'),
        ];
        return qrr_native_command($db, $user, 'box-transfer', $fields);
    }
    if ($action === 'mapping') {
        qrr_api_permit(!empty($user->admin));
        return qrr_command('mapping', [
            'user_id' => qrr_api_int($data, 'user_id'),
            'warehouse_id' => qrr_api_int($data, 'warehouse_id'),
            'users' => (object) qrr_personal_users($db),
            'warehouses' => (object) qrr_warehouses($db),
        ]);
    }
    if ($action === 'label-settings') {
        $wid = qrr_api_int($data, 'warehouse_id');
        $warehouses = qrr_warehouses($db);
        if (!isset($warehouses[$wid])) {
            throw new InvalidArgumentException('Unknown warehouse');
        }
        $prefs = qrr_binloc_validate_label_settings(
            qrr_binloc_levels($db, $wid),
            $data['format'] ?? [],
        );
        return qrr_command('label-settings', [
            'warehouse_id' => $wid,
            'prefs' => $prefs,
            'warehouses' => (object) $warehouses,
        ]);
    }
    if ($action === 'reconcile') {
        qrr_api_permit(qrr_stock_write_right($user));
        $code = qrr_input_code($data['code'] ?? '');
        $entry = qrr_load_state()['items'][$code] ?? [];
        if (!empty($entry['pending_handoff'])) {
            return qrr_reconcile_handoff($db, $user, $code, $entry['pending_handoff']);
        }
        return qrr_reconcile_inventory_action($db, $user, $code);
    }
    if ($action !== 'workflow') {
        throw new InvalidArgumentException('Unknown action');
    }
    $kind = (string) ($data['kind'] ?? '');
    if (!in_array($kind, ['move', 'consume', 'return', 'correct', 'checkout', 'checkin'], true)) {
        throw new InvalidArgumentException('Unknown workflow');
    }
    $codes = qrr_workflow_codes($data['codes'] ?? []);
    if (!$codes) {
        throw new InvalidArgumentException('Scan at least one QR label');
    }
    $warehouses = qrr_warehouses($db);
    $users = qrr_personal_users($db);
    $reason = trim(strip_tags((string) ($data['reason'] ?? '')));
    if (strlen($reason) > 200) {
        throw new InvalidArgumentException('Reason is too long');
    }
    $person = qrr_api_int($data, 'person_id');
    $wid = qrr_api_int($data, 'warehouse_id');
    $choice = qrr_binloc_choice($db, $wid, $data['levels'] ?? []);
    $ref = (string) ($data['reference_type'] ?? '');
    $refId = qrr_api_int($data, 'reference_id');
    if ($ref !== '') {
        qrr_check_reference($db, $user, $ref, $refId);
    }
    if ($kind === 'checkout') {
        qrr_api_permit(qrr_stock_write_right($user));
        qrr_ensure_personal_warehouse($db, $user, $person, $users);
        $warehouses = qrr_warehouses($db);
    }
    $results = [];
    foreach ($codes as $code) {
        try {
            $item = qrr_load_state()['items'][$code] ?? null;
            if (!$item) {
                throw new RuntimeException('Unknown QR label');
            }
            if ($kind === 'checkout' || $kind === 'checkin') {
                qrr_api_permit(qrr_stock_write_right($user));
                $borrower =
                    $kind === 'checkin' ? (int) ($item['checkout']['user_id'] ?? 0) : $person;
                $pending = qrr_stage_handoff(
                    $db,
                    $user,
                    $code,
                    $kind,
                    $borrower,
                    $reason,
                    $warehouses,
                    $users,
                );
                qrr_do_native_transfer($db, $user, $item, $pending);
                qrr_finish_handoff($db, $user, $code, $pending);
            } else {
                $quantities = $data['quantities'] ?? [];
                $quantity = qrr_api_int($quantities, $code, $item['type'] === 'box' ? 0 : 1);
                qrr_run_inventory_action(
                    $db,
                    $user,
                    $code,
                    $kind,
                    [
                        'warehouse_id' => $wid,
                        'choice' => $choice,
                        'quantity' => $quantity,
                        'reason' => $reason,
                        'post_stock' => !empty($data['post_stock']),
                        'reference_type' => $ref,
                        'reference_id' => $refId,
                    ],
                    $warehouses,
                );
            }
            $results[] = ['code' => $code, 'ok' => true, 'message' => 'Completed'];
        } catch (Throwable $e) {
            $results[] = ['code' => $code, 'ok' => false, 'message' => $e->getMessage()];
        }
    }
    return $results;
}
try {
    qrr_api_permit(qrr_read_right($user) && qrr_products_right($user));
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $response = qrr_api_get((string) GETPOST('resource', 'alphanohtml'));
    } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
        qrr_check_post();
        $payload = (string) ($_POST['payload'] ?? '');
        if (strlen($payload) > 262144) {
            throw new InvalidArgumentException('Request too large');
        }
        $data = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($data)) {
            throw new InvalidArgumentException('Expected operation data');
        }
        $response = ['result' => qrr_api_post((string) GETPOST('action', 'alphanohtml'), $data)];
    } else {
        http_response_code(405);
        header('Allow: GET, POST');
        throw new InvalidArgumentException('Unsupported method');
    }
    echo json_encode($response, JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_AMP);
} catch (Throwable $e) {
    if (http_response_code() < 400) {
        http_response_code(
            $e instanceof DomainException
                ? 403
                : ($e instanceof InvalidArgumentException || $e instanceof JsonException
                    ? 400
                    : 409),
        );
    }
    echo json_encode(['message' => $e->getMessage()], JSON_HEX_TAG | JSON_HEX_AMP);
}
