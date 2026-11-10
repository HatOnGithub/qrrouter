<?php
/** Recoverable native stock workflows and lot-specific Binloc assignments. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_workflow_codes($raw, $limit = 200) {
    if (is_array($raw)) {
        $raw = implode("\n", $raw);
    }
    if (!is_string($raw) || strlen($raw) > $limit * 65) {
        throw new RuntimeException('Too many scanned codes');
    }
    $codes = preg_split('/[\s,;]+/', strtoupper(trim($raw)), -1, PREG_SPLIT_NO_EMPTY);
    if (count($codes) > $limit) {
        throw new RuntimeException('Maximum ' . (int) $limit . ' codes per operation');
    }
    $unique = [];
    foreach ($codes as $code) {
        if (!qrr_code_valid($code)) {
            throw new RuntimeException('Invalid QR identifier: ' . substr($code, 0, 52));
        }
        $unique[$code] = $code;
    }
    return array_values($unique);
}
function qrr_registration_fields($db, $user, $posted, $warehouses, $type) {
    if (!in_array($type, ['tracked', 'generic', 'box'], true)) {
        throw new RuntimeException('Invalid registration type');
    }
    $label = trim(strip_tags((string) ($posted['label'] ?? '')));
    $pid = (int) ($posted['product_id'] ?? 0);
    $wid = (int) ($posted['warehouse_id'] ?? 0);
    $text = trim((string) ($posted['qty'] ?? ''));
    if ($type === 'box' && !preg_match('/^(?:0|[1-9][0-9]{0,8})$/D', $text)) {
        throw new RuntimeException('Enter a known quantity for this container');
    }
    $qty = $type === 'box' ? (int) $text : 1;
    $serial = $type === 'tracked' ? trim(strip_tags((string) ($posted['serial'] ?? ''))) : '';
    $details = $type === 'tracked' ? trim(strip_tags((string) ($posted['details'] ?? ''))) : '';
    $nativeBatch = $type === 'box' ? $label : ($type === 'tracked' ? $serial : '');
    if (strlen($nativeBatch) > 100) {
        throw new RuntimeException('Native batch value is too long');
    }
    $choice = qrr_binloc_choice($db, $wid, $posted['qrr_levels'] ?? []);
    qrr_item_validate(
        $type,
        $label,
        $pid,
        $wid,
        $choice['bin'],
        $qty,
        $details,
        $serial,
        $db,
        $warehouses,
        $user,
    );
    if (!$wid || !$pid) {
        throw new RuntimeException(
            'Choose a product and Dolibarr warehouse to register stock-tracked items',
        );
    }
    $product = qrr_product($db, $pid);
    if (!$product || (int) $product->type !== 0) {
        throw new RuntimeException(
            'Select a physical Dolibarr product. Services cannot be registered as warehouse stock.',
        );
    }
    return [
        'label' => $label,
        'product_id' => $pid,
        'warehouse_id' => $wid,
        'choice' => $choice,
        'qty' => $qty,
        'serial' => $serial,
        'details' => $details,
        'native_batch' => $nativeBatch,
    ];
}
/** Metadata registration only: native quantities are not increased on registration. */
function qrr_register_codes($db, $user, $codes, $type, $fields) {
    $data = array_merge(
        qrr_service_fields(
            $type,
            $fields['label'],
            $fields['product_id'],
            $fields['warehouse_id'],
            $fields['choice'],
            $fields['qty'],
            $fields['details'],
            $fields['serial'],
            $fields['native_batch'],
        ),
        ['codes' => $codes],
    );
    return in_array($type, ['tracked', 'box'], true)
        ? qrr_native_command($db, $user, 'register', $data)
        : qrr_command('register', $data);
}
function qrr_native_evidence($db, $op) {
    $sql =
        'SELECT fk_entrepot, value, fk_product, batch FROM ' .
        MAIN_DB_PREFIX .
        "stock_mouvement WHERE inventorycode='" .
        $db->escape($op['id']) .
        "'";
    $res = $db->query($sql);
    if (!$res) {
        throw new RuntimeException(
            qrr_native_error('Cannot verify native stock movements', $db->lasterror()),
        );
    }
    $expected = $op['effects'];
    $seen = array_fill(0, count($expected), 0);
    $other = 0;
    while ($m = $db->fetch_object($res)) {
        $matched = false;
        foreach ($expected as $i => $effect) {
            if (
                (int) $m->fk_product === (int) $op['product_id'] &&
                (empty($op['native_batch']) ||
                    (string) ($m->batch ?? '') === $op['native_batch']) &&
                (int) $m->fk_entrepot === (int) $effect['warehouse_id'] &&
                abs((float) $m->value - (float) $effect['delta']) < 0.00001
            ) {
                $seen[$i]++;
                $matched = true;
                break;
            }
        }
        if (!$matched) {
            $other++;
        }
    }
    $db->free($res);
    $proof = ['seen' => $seen, 'other' => $other];
    if (!empty($op['product_lot_id']) && isset($op['location_target'])) {
        $proof['location'] = qrr_native_location_matches(
            $db,
            $op['product_lot_id'],
            $op['product_id'],
            $op['location_target'],
        );
    }
    return $proof;
}

function qrr_native_evidence_none($proof) {
    if ($proof['other'] !== 0) {
        return false;
    }
    foreach ($proof['seen'] as $count) {
        if ($count !== 0) {
            return false;
        }
    }
    return true;
}
/** Stock adjustments are committed through Dolibarr's own Product API. */
function qrr_native_apply($db, $user, $entry, $op) {
    if (!qrr_stock_write_right($user)) {
        throw new RuntimeException('Stock movement permission required');
    }
    if ($op['effects'] && !qrr_native_evidence_none(qrr_native_evidence($db, $op))) {
        throw new RuntimeException(
            'Movement with this inventory code already exists. Reconcile before retrying.',
        );
    }
    $product = qrr_product($db, (int) $op['product_id']);
    if (!$product || (int) $product->type !== 0) {
        throw new RuntimeException('Native stock changes require a physical Dolibarr product');
    }
    require_once DOL_DOCUMENT_ROOT . '/product/stock/class/entrepot.class.php';
    foreach ($op['effects'] as $effect) {
        $w = new Entrepot($db);
        if (
            $w->fetch((int) $effect['warehouse_id']) <= 0 ||
            (int) $w->status === (int) Entrepot::STATUS_CLOSED
        ) {
            throw new RuntimeException('Warehouse unavailable or closed');
        }
        if (
            (float) $effect['delta'] < 0 &&
            qrr_stock_qty($db, (int) $op['product_id'], (int) $effect['warehouse_id']) + 0.00001 <
                -(float) $effect['delta']
        ) {
            throw new RuntimeException('Insufficient stock in source warehouse');
        }
    }
    if ($db->begin() <= 0) {
        throw new RuntimeException('Cannot begin native stock transaction');
    }
    try {
        $product->load_stock('novirtual');
        $price = isset($product->pmp) ? (float) $product->pmp : 0.0;
        $eatby = 0;
        $sellby = 0;
        if (!empty($entry['product_lot_id'])) {
            [, $lot] = qrr_native_lot($db, $entry);
            $eatby = $lot->eatby ?: 0;
            $sellby = $lot->sellby ?: 0;
        }
        foreach ($op['effects'] as $effect) {
            $wh = (int) $effect['warehouse_id'];
            $signed = (int) $effect['delta'];
            $n = abs($signed);
            if ($n === 0) {
                continue;
            }
            $label =
                'QR ' .
                substr($op['kind'], 0, 35) .
                ' ' .
                $entry['code'] .
                ' ' .
                substr((string) ($op['reason'] ?? ''), 0, 100);
            if ($product->hasbatch()) {
                $batch = (string) ($entry['native_batch'] ?? '');
                if ($batch === '') {
                    throw new RuntimeException(
                        'Native batch/serial missing. Use a native Dolibarr adjustment first.',
                    );
                }
                if ($signed < 0) {
                    [$batch, $eatby, $sellby] = qrr_native_batch($db, $product, $entry, $wh, $n);
                } elseif ($op['kind'] !== 'move' && empty($entry['product_lot_id'])) {
                    $eatby = 0;
                    $sellby = 0;
                }
                $result = $product->correct_stock_batch(
                    $user,
                    $wh,
                    $n,
                    $signed < 0 ? 1 : 0,
                    $label,
                    $price,
                    $eatby,
                    $sellby,
                    $batch,
                    $op['id'],
                );
            } else {
                $result = $product->correct_stock(
                    $user,
                    $wh,
                    $n,
                    $signed < 0 ? 1 : 0,
                    $label,
                    $price,
                    $op['id'],
                );
            }
            if ($result < 0) {
                throw new RuntimeException(
                    qrr_native_error(
                        'Native stock change failed',
                        $product->error ?: implode('; ', (array) $product->errors),
                    ),
                );
            }
        }
        if (!empty($entry['product_lot_id']) && isset($op['location_target'])) {
            qrr_native_save_location(
                $db,
                $user,
                array_merge($entry, $op['location_target']),
                $entry['product_lot_id'],
            );
        }
        if ($db->commit() <= 0) {
            throw new RuntimeException(
                'Commit status unknown; reconcile pending QR operation before retrying',
            );
        }
    } catch (Throwable $e) {
        $db->rollback();
        throw $e;
    }
}

/** Plans the only allowed persisted changes, never accepting arbitrary field replacement from POST. */

function qrr_run_inventory_action($db, $user, $code, $kind, $args, $warehouses) {
    $data = [
        'code' => $code,
        'kind' => $kind,
        'args' => $args,
        'warehouses' => (object) $warehouses,
    ];
    $plan = qrr_command('plan', $data);
    $entry = qrr_load_state()['items'][$code];
    qrr_service_preflight($db, $user, $entry, $plan);
    $data['revision'] = $plan['revision'];
    $op = qrr_command('stage', $data);
    if (!$op['effects'] && empty($op['product_lot_id'])) {
        return $op;
    }
    try {
        qrr_native_apply($db, $user, $entry, $op);
    } catch (Throwable $e) {
        throw new RuntimeException(
            qrr_public_error($e) . ' Pending operation retained. Reconcile before retrying.',
        );
    }
    qrr_finish_inventory_action($db, $user, $code, $op);
    return $op;
}
function qrr_finish_inventory_action($db, $user, $code, $op) {
    return qrr_command('finish', [
        'code' => $code,
        'id' => $op['id'],
        'proof' => qrr_native_evidence($db, $op),
    ]);
}
function qrr_reconcile_inventory_action($db, $user, $code) {
    $op = qrr_load_state()['items'][$code]['pending_operation'] ?? null;
    if (!$op) {
        throw new RuntimeException('No pending operation');
    }
    return qrr_command('reconcile', [
        'code' => $code,
        'id' => $op['id'],
        'proof' => qrr_native_evidence($db, $op),
    ]);
}
function qrr_reference_schema($type) {
    $map = ['shipment' => 'expedition', 'production' => 'mrp_mo', 'salesorder' => 'commande'];
    if (!isset($map[$type])) {
        throw new RuntimeException('Invalid transaction type');
    }
    return $map[$type];
}
function qrr_check_reference($db, $user, $type, $id) {
    $table = qrr_reference_schema($type);
    if ($id < 1) {
        throw new RuntimeException('Select an exact shipment or order');
    }
    if (!qrr_reference_visible($user, $type, $id)) {
        throw new DomainException('Transaction is inaccessible');
    }
    if ($type === 'salesorder' && !qrr_orders_right($user)) {
        throw new RuntimeException('Missing sales order permission');
    }
    if ($type === 'shipment' && empty($user->admin) && !$user->hasRight('expedition', 'lire')) {
        throw new RuntimeException('Missing shipment permission');
    }
    if ($type === 'production' && empty($user->admin) && !$user->hasRight('mrp', 'read')) {
        throw new RuntimeException('Missing production order permission');
    }
    $sql =
        'SELECT rowid FROM ' .
        MAIN_DB_PREFIX .
        $table .
        ' WHERE rowid=' .
        (int) $id .
        ' AND entity=' .
        (int) $GLOBALS['conf']->entity;
    $rs = $db->query($sql);
    if (!$rs || !$db->fetch_object($rs)) {
        throw new RuntimeException('Transaction not found in this entity');
    }
    $db->free($rs);
}

/** Resolve saved consumption references only within the current entity and user's read rights. */
function qrr_consumption_references($db, $user, $items) {
    global $conf;
    $routes = [
        'shipment' => '/expedition/card.php',
        'production' => '/mrp/mo_card.php',
        'salesorder' => '/commande/card.php',
    ];
    $groups = [];
    foreach ($items as $item) {
        foreach ($item['consumption_log'] ?? [] as $entry) {
            $type = (string) ($entry['reference_type'] ?? '');
            $id = (int) ($entry['reference_id'] ?? 0);
            if (isset($routes[$type]) && $id > 0) {
                $groups[$type][$id] = $id;
            }
        }
    }
    $references = [];
    foreach ($groups as $type => $ids) {
        $allowed = qrr_reference_right($user, $type);
        if (!$allowed) {
            continue;
        }
        $sql =
            'SELECT rowid,ref FROM ' .
            MAIN_DB_PREFIX .
            qrr_reference_schema($type) .
            ' WHERE entity=' .
            (int) $conf->entity .
            ' AND rowid IN (' .
            implode(',', $ids) .
            ')';
        $result = $db->query($sql);
        if (!$result) {
            continue;
        }
        while ($row = $db->fetch_object($result)) {
            $id = (int) $row->rowid;
            if (isset($ids[$id]) && qrr_reference_visible($user, $type, $id)) {
                $references[$type . ':' . $id] = [
                    'type' => $type,
                    'id' => $id,
                    'ref' => (string) $row->ref,
                    'url' => dol_buildpath($routes[$type], 1) . '?id=' . $id,
                ];
            }
        }
        $db->free($result);
    }
    return $references;
}
