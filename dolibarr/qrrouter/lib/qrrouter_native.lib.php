<?php
/** Native lot/serial identity, stock and Binloc persistence (Dolibarr 21+ / Binloc 2.19+). */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_native_location($db) {
    $path = dol_buildpath('/binloc/class/binlocproductlocation.class.php', 0);
    if (!$path || !is_file($path)) {
        throw new RuntimeException('Binloc 2.19 or newer is required for lot/serial locations');
    }
    require_once $path;
    $location = new BinlocProductLocation($db);
    foreach (['fetchAnyByLot', 'setRawValues', 'createOrUpdate'] as $method) {
        if (!is_callable([$location, $method])) {
            throw new RuntimeException(
                'Installed Binloc lacks the required lot/serial APIs. Install a compatible Binloc 2.19.1 or newer.',
            );
        }
    }
    return $location;
}

function qrr_native_rights($user) {
    if (
        !qrr_stock_write_right($user) ||
        (empty($user->admin) &&
            (!$user->hasRight('binloc', 'write') || !$user->hasRight('produit', 'creer')))
    ) {
        throw new DomainException(
            'Stock movement, product creation and Binloc write permissions required',
        );
    }
}

function qrr_native_location_matches($db, $lotId, $productId, $target) {
    $location = qrr_native_location($db);
    if (
        $location->fetchAnyByLot((int) $lotId) <= 0 ||
        (int) $location->fk_product !== (int) $productId ||
        (int) $location->fk_entrepot !== (int) $target['warehouse_id']
    ) {
        return false;
    }
    $actual = [];
    foreach ($location->values as $id => $value) {
        $actual[(string) $id] = (string) (!empty($value->fk_option)
            ? $value->fk_option
            : $value->value);
    }
    $expected = array_map('strval', (array) ($target['bin_values'] ?? []));
    ksort($actual);
    ksort($expected);
    return $actual === $expected;
}

/** Generate a native serial before staging, so recovery reuses the same identity. */
function qrr_native_serial_exists($db, $productId, $serial) {
    require_once DOL_DOCUMENT_ROOT . '/product/stock/class/productlot.class.php';
    if (!qrr_product($db, (int) $productId)) {
        throw new InvalidArgumentException('Unknown product');
    }
    $lot = new Productlot($db);
    $found = $lot->fetch(0, (int) $productId, $serial);
    if ($found < 0) {
        throw new RuntimeException(
            qrr_native_error('Cannot check Dolibarr serial availability', $lot->error),
        );
    }
    return $found > 0;
}

function qrr_native_generate_serial($db, $productId, $label) {
    require_once DOL_DOCUMENT_ROOT . '/product/stock/class/productlot.class.php';
    $product = qrr_product($db, (int) $productId);
    if (!$product) {
        throw new InvalidArgumentException('Unknown product');
    }
    $prefix = trim(
        preg_replace('/[^A-Z0-9]+/', '-', strtoupper($product->ref . '-' . $label)),
        '-',
    );
    $prefix = rtrim(substr($prefix, 0, 60), '-');
    for ($attempt = 0; $attempt < 10; $attempt++) {
        $serial = ($prefix !== '' ? $prefix : 'SN') . '-' . strtoupper(bin2hex(random_bytes(12)));
        $lot = new Productlot($db);
        $found = $lot->fetch(0, (int) $productId, $serial);
        if ($found < 0) {
            throw new RuntimeException(
                qrr_native_error('Cannot check Dolibarr serial availability', $lot->error),
            );
        }
        if ($found === 0) {
            return $serial;
        }
    }
    throw new RuntimeException('Cannot generate an unused Dolibarr serial number');
}

function qrr_native_lot($db, $item, $create = false) {
    global $conf, $user;
    require_once DOL_DOCUMENT_ROOT . '/product/stock/class/productlot.class.php';
    $product = qrr_product($db, (int) $item['product_id']);
    if (
        !$product ||
        (int) $product->type !== 0 ||
        !in_array(
            (int) $product->entity,
            array_map('intval', explode(',', getEntity('product'))),
            true,
        )
    ) {
        throw new RuntimeException('Physical product outside accessible entities or missing');
    }
    if (!$product->hasbatch()) {
        throw new RuntimeException(
            'Enable lot/serial tracking on the selected Dolibarr product first',
        );
    }
    $lot = new Productlot($db);
    $result = !empty($item['product_lot_id'])
        ? $lot->fetch((int) $item['product_lot_id'])
        : $lot->fetch(0, (int) $product->id, (string) $item['native_batch']);
    if ($result < 0) {
        throw new RuntimeException(
            qrr_native_error('Cannot read Dolibarr lot/serial', $lot->error),
        );
    }
    if ($result === 0 && $create && empty($item['product_lot_id'])) {
        $lot->entity = (int) $conf->entity;
        $lot->fk_product = (int) $product->id;
        $lot->batch = (string) $item['native_batch'];
        if ($lot->create($user) <= 0) {
            throw new RuntimeException(
                qrr_native_error('Cannot create Dolibarr lot/serial', $lot->error),
            );
        }
    } elseif ($result === 0) {
        throw new RuntimeException('Linked Dolibarr lot/serial no longer exists');
    }
    if (
        (int) $lot->fk_product !== (int) $product->id ||
        !in_array(
            (int) $lot->entity,
            array_map('intval', explode(',', getEntity('productbatch'))),
            true,
        )
    ) {
        throw new RuntimeException('Dolibarr lot/serial outside accessible product or entity');
    }
    return [$product, $lot];
}

function qrr_native_lot_qty($db, $item, $warehouseId) {
    $sql =
        'SELECT SUM(b.qty) AS qty FROM ' .
        MAIN_DB_PREFIX .
        'product_batch b' .
        ' INNER JOIN ' .
        MAIN_DB_PREFIX .
        'product_stock s ON s.rowid=b.fk_product_stock' .
        ' WHERE s.fk_product=' .
        (int) $item['product_id'] .
        ' AND s.fk_entrepot=' .
        (int) $warehouseId .
        " AND b.batch='" .
        $db->escape($item['native_batch']) .
        "'";
    $result = $db->query($sql);
    if (!$result) {
        throw new RuntimeException('Cannot read native lot stock');
    }
    $row = $db->fetch_object($result);
    $db->free($result);
    $qty = (float) ($row->qty ?? 0);
    if ($qty < 0 || $qty > 100000000 || floor($qty) !== $qty) {
        throw new RuntimeException('QR inventory requires nonnegative whole-unit lot stock');
    }
    return (int) $qty;
}

/** A QR serial or physical box occupies one warehouse; detect native splits rather than hide stock. */
function qrr_native_lot_warehouses($db, $item) {
    $result = $db->query(
        'SELECT s.fk_entrepot, SUM(b.qty) AS qty FROM ' .
            MAIN_DB_PREFIX .
            'product_batch b' .
            ' INNER JOIN ' .
            MAIN_DB_PREFIX .
            'product_stock s ON s.rowid=b.fk_product_stock' .
            ' WHERE s.fk_product=' .
            (int) $item['product_id'] .
            " AND b.batch='" .
            $db->escape($item['native_batch']) .
            "' GROUP BY s.fk_entrepot HAVING SUM(b.qty)>0",
    );
    if (!$result) {
        throw new RuntimeException('Cannot read native lot warehouse stock');
    }
    $stocks = [];
    while ($row = $db->fetch_object($result)) {
        $stocks[(int) $row->fk_entrepot] = (float) $row->qty;
    }
    $db->free($result);
    if (count($stocks) > 1) {
        throw new RuntimeException(
            'A QR serial or box lot is split across warehouses. Consolidate that lot in Dolibarr first.',
        );
    }
    return $stocks;
}

/** Live observations override the service's display/planning cache. Never fall back on stale data. */
function qrr_native_observations($db, $state) {
    $observations = [];
    $warehouses = null;
    foreach ($state['items'] as $code => $item) {
        if (
            empty($item['product_lot_id']) ||
            !empty($item['pending_operation']) ||
            !empty($item['pending_handoff'])
        ) {
            continue;
        }
        if ($warehouses === null) {
            $warehouses = qrr_warehouses($db);
        }
        if (!qrr_item_visible($db, $item, $warehouses)) {
            continue;
        }
        [, $lot] = qrr_native_lot($db, $item);
        $item['native_batch'] = (string) $lot->batch;
        $stocks = qrr_native_lot_warehouses($db, $item);
        $location = qrr_native_location($db);
        $found = $location->fetchAnyByLot((int) $lot->id);
        if ($found < 0) {
            throw new RuntimeException('Cannot read native Binloc assignment');
        }
        $wid = $found > 0 ? (int) $location->fk_entrepot : (int) $item['warehouse_id'];
        if ($stocks && !isset($stocks[$wid])) {
            $wid = (int) array_key_first($stocks);
            $found = 0; // Dolibarr moved the stock; the old warehouse's bin cannot follow it.
        }
        if (
            !isset($warehouses[$wid]) ||
            ($found > 0 && (int) $location->fk_product !== (int) $item['product_id'])
        ) {
            throw new RuntimeException(
                'Native Binloc assignment outside accessible product or warehouse',
            );
        }
        $values = [];
        $parts = [];
        $key = [];
        foreach (qrr_binloc_levels($db, $wid) as $id => $cfg) {
            $value = $found > 0 ? $location->values[$id] ?? null : null;
            if (!$value) {
                continue;
            }
            $values[$id] = !empty($value->fk_option)
                ? (int) $value->fk_option
                : (string) $value->value;
            $parts[] = (string) $value->display;
            $key[] =
                $id .
                (!empty($value->fk_option)
                    ? ':o' . $value->fk_option
                    : ':v' . strtolower($value->value));
        }
        $qty = qrr_native_lot_qty($db, $item, $wid);
        if ($item['type'] === 'tracked' && $qty > 1) {
            throw new RuntimeException('A tracked serial must have at most one unit');
        }
        $observations[$code] = [
            'warehouse_id' => $wid,
            'qty' => $qty,
            'bin' => qrr_binloc_display_code($db, $wid, qrr_binloc_levels($db, $wid), $parts),
            'bin_key' => implode('|', $key),
            'bin_values' => (object) $values,
            'native_batch' => (string) $lot->batch,
            'serial' => $item['type'] === 'tracked' ? (string) $lot->batch : '',
            'label' => $item['type'] === 'box' ? (string) $lot->batch : $item['label'],
            'status' =>
                $qty > 0
                    ? 'in_stock'
                    : ($item['type'] === 'tracked'
                        ? 'consumed'
                        : $item['status']),
        ];
    }
    return $observations;
}

function qrr_native_save_location($db, $user, $item, $lotId) {
    qrr_native_rights($user);
    $wid = (int) $item['warehouse_id'];
    if (!isset(qrr_warehouses($db)[$wid])) {
        throw new RuntimeException('Warehouse outside accessible entities');
    }
    $location = qrr_native_location($db);
    $location->fk_product = (int) $item['product_id'];
    $location->fk_entrepot = $wid;
    $location->fk_product_lot = (int) $lotId;
    $values = (array) ($item['bin_values'] ?? []);
    $levels = qrr_binloc_levels($db, $wid);
    qrr_binloc_parse_levels($levels, $values);
    if ($location->setRawValues($levels, $values) < 0 || $location->createOrUpdate($user) <= 0) {
        throw new RuntimeException(
            qrr_native_error('Cannot save Binloc assignment', $location->error),
        );
    }
}

function qrr_native_receipt($db, $id) {
    global $conf;
    $result = $db->query(
        'SELECT bindings FROM ' .
            MAIN_DB_PREFIX .
            'qrrouter_native_receipt WHERE entity=' .
            (int) $conf->entity .
            " AND operation_id='" .
            $db->escape($id) .
            "'",
    );
    if (!$result) {
        throw new RuntimeException(
            'Native receipt table unavailable. Re-enable QR Router to install its tables.',
        );
    }
    $row = $db->fetch_object($result);
    $db->free($result);
    return $row ? json_decode($row->bindings, true, 512, JSON_THROW_ON_ERROR) : null;
}

/** Durable service intent + transactional native receipt make retries safe after lost responses. */
function qrr_native_complete($db, $user, $pending) {
    global $conf;
    qrr_native_rights($user);
    qrr_require_native_visible($db, $pending);
    $id = $pending['id'];
    $bindings = qrr_native_receipt($db, $id);
    if (!empty($bindings['cancelled'])) {
        throw new RuntimeException('This native synchronization was cancelled');
    }
    if ($bindings === null) {
        if ($db->begin() <= 0) {
            throw new RuntimeException('Cannot begin native transaction');
        }
        try {
            // The unique key serializes concurrent recovery requests. An uncommitted claim is never evidence.
            if (
                !$db->query(
                    'INSERT INTO ' .
                        MAIN_DB_PREFIX .
                        'qrrouter_native_receipt (entity,operation_id,bindings) VALUES (' .
                        (int) $conf->entity .
                        ",'" .
                        $db->escape($id) .
                        "','{}')",
                )
            ) {
                throw new RuntimeException(
                    'Synchronization already running; refresh before recovery',
                );
            }
            $bindings = [];
            $products = [];
            foreach ($pending['changes'] as $change) {
                if (!empty($change['after']['native_batch'])) {
                    $products[] = (int) $change['after']['product_id'];
                }
            }
            $products = array_unique($products);
            sort($products);
            if (
                $products &&
                !$db->query(
                    'SELECT rowid FROM ' .
                        MAIN_DB_PREFIX .
                        'product_stock WHERE fk_product IN (' .
                        implode(',', $products) .
                        ') ORDER BY fk_product,fk_entrepot FOR UPDATE',
                )
            ) {
                throw new RuntimeException('Cannot lock native product stock');
            }
            foreach ($pending['changes'] as $code => $change) {
                $after = $change['after'];
                $before = $change['before'];
                if (empty($after['native_batch'])) {
                    continue;
                }
                [$product, $lot] = qrr_native_lot($db, $after, true);
                $bindings[$code] = (int) $lot->id;
                $after['native_batch'] = (string) $lot->batch;
                $wid = (int) $after['warehouse_id'];
                require_once DOL_DOCUMENT_ROOT . '/product/stock/class/entrepot.class.php';
                $warehouse = new Entrepot($db);
                if (
                    $warehouse->fetch($wid) <= 0 ||
                    (int) $warehouse->status === (int) Entrepot::STATUS_CLOSED
                ) {
                    throw new RuntimeException('Warehouse missing or closed');
                }
                $current = qrr_native_lot_qty($db, $after, $wid);
                $stocks = qrr_native_lot_warehouses($db, $after);
                if ($stocks && !isset($stocks[$wid])) {
                    throw new RuntimeException('Lot/serial already has stock in another warehouse');
                }
                $target = (int) $after['qty'];
                if ($after['type'] === 'tracked' && $current > 1) {
                    throw new RuntimeException('A tracked serial must have at most one unit');
                }
                if (
                    $before &&
                    !empty($before['product_lot_id']) &&
                    $current !== (int) $before['qty']
                ) {
                    throw new RuntimeException(
                        'Native lot quantity changed; resolve the pending synchronization',
                    );
                }
                $linkExisting =
                    ($pending['action'] === 'register' && empty($pending['receive_new_serial'])) ||
                    !empty($pending['link_existing']);
                if ($linkExisting && $current !== $target) {
                    throw new RuntimeException(
                        'Registration requires matching existing native lot stock; receive or correct stock in Dolibarr first',
                    );
                }
                if (!$before && $current !== 0 && !$linkExisting) {
                    throw new RuntimeException(
                        'Lot/serial already has stock. Use Register items to link existing inventory',
                    );
                }
                $delta = $target - $current;
                if ($delta !== 0) {
                    $result = $product->correct_stock_batch(
                        $user,
                        $wid,
                        abs($delta),
                        $delta < 0 ? 1 : 0,
                        'QR ' . $pending['action'] . ' ' . $code,
                        (float) ($product->pmp ?? 0),
                        $lot->eatby ?: 0,
                        $lot->sellby ?: 0,
                        (string) $lot->batch,
                        $id,
                    );
                    if ($result < 0) {
                        throw new RuntimeException(
                            qrr_native_error('Native lot stock change failed', $product->error),
                        );
                    }
                }
                qrr_native_save_location($db, $user, $after, (int) $lot->id);
            }
            if (
                !$db->query(
                    'UPDATE ' .
                        MAIN_DB_PREFIX .
                        "qrrouter_native_receipt SET bindings='" .
                        $db->escape(json_encode((object) $bindings, JSON_THROW_ON_ERROR)) .
                        "' WHERE entity=" .
                        (int) $conf->entity .
                        " AND operation_id='" .
                        $db->escape($id) .
                        "'",
                )
            ) {
                throw new RuntimeException('Cannot save native synchronization receipt');
            }
            if ($db->commit() <= 0) {
                throw new RuntimeException(
                    'Native commit status unknown; recover the pending synchronization',
                );
            }
        } catch (Throwable $error) {
            $db->rollback();
            throw new RuntimeException(
                qrr_public_error($error) .
                    ' Pending synchronization retained; use Recover synchronization.',
            );
        }
    }
    return qrr_service('POST', 'native-finish', ['id' => $id, 'bindings' => (object) $bindings]);
}

function qrr_native_command($db, $user, $action, $fields) {
    qrr_native_rights($user);
    $linkExisting =
        (in_array($action, ['create', 'register'], true) ||
            ($action === 'update' &&
                empty(qrr_load_state()['items'][$fields['code']]['product_lot_id']))) &&
        ($fields['type'] ?? '') === 'tracked' &&
        qrr_native_serial_exists($db, $fields['product_id'], $fields['serial']);
    if ($linkExisting) {
        $fields['qty'] = qrr_native_lot_qty($db, $fields, (int) $fields['warehouse_id']);
        if ($fields['qty'] > 1) {
            throw new RuntimeException('A tracked serial must have at most one unit');
        }
    }
    if (in_array($fields['type'] ?? '', ['tracked', 'box'], true)) {
        $product = qrr_product($db, $fields['product_id']);
        if (!$product || !$product->hasbatch()) {
            throw new RuntimeException(
                'Enable lot/serial tracking on the selected Dolibarr product first',
            );
        }
        if (($fields['qty'] ?? null) === null) {
            throw new InvalidArgumentException('Enter a known quantity for the native lot');
        }
    }
    $pending = qrr_command('native-stage', [
        'action' => $action,
        'fields' => (object) $fields,
        'link_existing' => $linkExisting,
        'receive_new_serial' =>
            $action === 'register' && ($fields['type'] ?? '') === 'tracked' && !$linkExisting,
    ]);
    return qrr_native_complete($db, $user, $pending);
}

function qrr_native_cancel($db, $user, $pending) {
    global $conf;
    qrr_native_rights($user);
    qrr_require_native_visible($db, $pending);
    $id = $pending['id'];
    $receipt = qrr_native_receipt($db, $id);
    if ($receipt !== null && empty($receipt['cancelled'])) {
        throw new RuntimeException(
            'Native changes already committed. Recover synchronization to finish.',
        );
    }
    if ($receipt === null) {
        if (
            !$db->query(
                'INSERT INTO ' .
                    MAIN_DB_PREFIX .
                    'qrrouter_native_receipt (entity,operation_id,bindings) VALUES (' .
                    (int) $conf->entity .
                    ",'" .
                    $db->escape($id) .
                    "','{\"cancelled\":true}')",
            )
        ) {
            throw new RuntimeException(
                'Synchronization changed or is running; refresh before cancellation',
            );
        }
    }
    return qrr_service('POST', 'native-cancel', ['id' => $id, 'cancelled_receipt' => true]);
}
