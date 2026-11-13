<?php
/** Native warehouse stock transfers and lot-specific internal location assignments for QR handoffs. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_stock_write_right($user) {
    return qrr_inventory_right($user) &&
        qrr_write_right($user) &&
        (!empty($user->admin) || $user->hasRight('stock', 'mouvement', 'creer'));
}
function qrr_native_batch($db, $product, $item, $warehouseId, $qty) {
    $batch = trim((string) ($item['native_batch'] ?? ''));
    if (!$product->hasbatch()) {
        return ['', 0, 0];
    }
    if ($batch === '') {
        throw new RuntimeException(
            'This Dolibarr product uses native lot/serial tracking. Assign the actual Dolibarr batch/serial in the tracked QR record first.',
        );
    }
    // Source batch must be present, and contain enough units.
    $sql = 'SELECT b.qty, b.eatby, b.sellby FROM ' . MAIN_DB_PREFIX . 'product_batch b';
    $sql .= ' INNER JOIN ' . MAIN_DB_PREFIX . 'product_stock s ON s.rowid=b.fk_product_stock';
    $sql .=
        ' WHERE s.fk_product=' . (int) $product->id . ' AND s.fk_entrepot=' . (int) $warehouseId;
    $sql .= " AND b.batch='" . $db->escape($batch) . "'";
    $r = $db->query($sql);
    if (!$r) {
        throw new RuntimeException(
            qrr_native_error('Cannot check native batch stock', $db->lasterror()),
        );
    }
    $obj = $db->fetch_object($r);
    if (!$obj || (float) $obj->qty + 0.00001 < $qty) {
        throw new RuntimeException(
            'Not enough stock in the recorded native lot/serial in the source warehouse.',
        );
    }
    $eatby = $obj->eatby ? $db->jdate($obj->eatby) : 0;
    $sellby = $obj->sellby ? $db->jdate($obj->sellby) : 0;
    return [$batch, $eatby, $sellby];
}
/** Return signed movements tagged with one unique inventory code. Read only. */
function qrr_transfer_evidence($db, $pending) {
    $sql =
        'SELECT fk_entrepot, value, fk_product, batch FROM ' .
        MAIN_DB_PREFIX .
        'stock_mouvement WHERE inventorycode=\'';
    $sql .= $db->escape($pending['inventorycode']) . "'";
    $res = $db->query($sql);
    if (!$res) {
        throw new RuntimeException('Cannot verify Dolibarr transfer movements.');
    }
    $out = 0;
    $in = 0;
    $extra = 0;
    while ($m = $db->fetch_object($res)) {
        $pid = (int) $m->fk_product;
        $wid = (int) $m->fk_entrepot;
        $qty = (float) $m->value;
        if (
            !empty($pending['native_batch']) &&
            (string) ($m->batch ?? '') !== $pending['native_batch']
        ) {
            $extra++;
            continue;
        }
        if (
            $pid === (int) $pending['product_id'] &&
            $wid === (int) $pending['from'] &&
            abs($qty + (int) $pending['qty']) < 0.00001
        ) {
            $out++;
        } elseif (
            $pid === (int) $pending['product_id'] &&
            $wid === (int) $pending['to'] &&
            abs($qty - (int) $pending['qty']) < 0.00001
        ) {
            $in++;
        } else {
            $extra++;
        }
    }
    $proof = ['out' => $out, 'in' => $in, 'extra' => $extra];
    return $proof;
}

function qrr_transfer_evidence_none($e) {
    return $e['out'] === 0 && $e['in'] === 0 && $e['extra'] === 0;
}
/** Execute the native Product::correct_stock[_batch] transfer pattern. */
function qrr_do_native_transfer($db, $user, $item, $pending) {
    if (!qrr_stock_write_right($user)) {
        throw new RuntimeException('Stock movement permission required');
    }
    if (!qrr_transfer_evidence_none(qrr_transfer_evidence($db, $pending))) {
        throw new RuntimeException('Native movements already exist; reconcile before retrying');
    }
    $pid = (int) $pending['product_id'];
    $from = (int) $pending['from'];
    $to = (int) $pending['to'];
    $qty = (int) $pending['qty'];
    if (!$pid || !$from || !$to || $from === $to || $qty < 1) {
        throw new RuntimeException('Invalid warehouse transfer');
    }
    require_once DOL_DOCUMENT_ROOT . '/product/stock/class/entrepot.class.php';
    foreach ([$from, $to] as $whid) {
        $warehouse = new Entrepot($db);
        if ($warehouse->fetch($whid) <= 0) {
            throw new RuntimeException('Warehouse is unavailable');
        }
        if (qrr_warehouse_closed($warehouse)) {
            throw new RuntimeException('Cannot transfer stock to or from a closed warehouse');
        }
    }
    if (qrr_stock_qty($db, $pid, $from) + 0.00001 < $qty) {
        throw new RuntimeException('Insufficient stock in source warehouse');
    }
    $product = qrr_product($db, $pid);
    if (!$product || (int) $product->type !== 0) {
        throw new RuntimeException('Only physical Dolibarr products may be checked out');
    }
    if (!$db->begin()) {
        throw new RuntimeException('Cannot start native stock transaction');
    }
    try {
        $product->load_stock('novirtual');
        [$batch, $eatby, $sellby] = qrr_native_batch($db, $product, $item, $from, $qty);
        $label =
            'QR ' .
            ($pending['kind'] === 'checkout' ? 'check-out' : 'check-in') .
            ' ' .
            $item['code'] .
            ' / user ' .
            $pending['person_id'];
        $inventorycode = $pending['inventorycode'];
        $price = isset($product->pmp) ? (float) $product->pmp : 0.0;
        if ($product->hasbatch()) {
            $r1 = $product->correct_stock_batch(
                $user,
                $from,
                $qty,
                1,
                $label,
                $price,
                $eatby,
                $sellby,
                $batch,
                $inventorycode,
            );
            if ($r1 < 0) {
                throw new RuntimeException(
                    qrr_native_error(
                        'Native stock decrease failed',
                        $product->error ?: implode('; ', (array) $product->errors),
                    ),
                );
            }
            $r2 = $product->correct_stock_batch(
                $user,
                $to,
                $qty,
                0,
                $label,
                $price,
                $eatby,
                $sellby,
                $batch,
                $inventorycode,
            );
        } else {
            $r1 = $product->correct_stock($user, $from, $qty, 1, $label, $price, $inventorycode);
            if ($r1 < 0) {
                throw new RuntimeException(
                    qrr_native_error(
                        'Native stock decrease failed',
                        $product->error ?: implode('; ', (array) $product->errors),
                    ),
                );
            }
            $r2 = $product->correct_stock($user, $to, $qty, 0, $label, $price, $inventorycode);
        }
        if ($r2 < 0) {
            throw new RuntimeException(
                qrr_native_error(
                    'Native stock increase failed',
                    $product->error ?: implode('; ', (array) $product->errors),
                ),
            );
        }
        if ($db->commit() <= 0) {
            throw new RuntimeException(
                'Dolibarr stock transaction commit failed; reconcile before retrying.',
            );
        }
    } catch (Throwable $e) {
        $db->rollback();
        throw $e;
    }
}
/** Durable staged state: if the PHP request crashes after stock commit, reconcile using inventorycode. */
function qrr_stage_handoff($db, $user, $code, $kind, $personId, $reason, $warehouses, $users) {
    $data = [
        'code' => $code,
        'kind' => $kind,
        'args' => ['person_id' => $personId, 'reason' => $reason],
        'warehouses' => (object) $warehouses,
        'users' => (object) $users,
    ];
    $plan = qrr_command('handoff-plan', $data);
    $entry = qrr_load_state()['items'][$code];
    qrr_service_preflight($db, $user, $entry, $plan);
    $data['revision'] = $plan['revision'];
    return qrr_command('handoff-stage', $data);
}
function qrr_finish_handoff($db, $user, $code, $pending) {
    return qrr_command('handoff-finish', [
        'code' => $code,
        'id' => $pending['id'],
        'proof' => qrr_transfer_evidence($db, $pending),
    ]);
}
function qrr_reconcile_handoff($db, $user, $code, $pending) {
    return qrr_command('handoff-reconcile', [
        'code' => $code,
        'id' => $pending['id'],
        'proof' => qrr_transfer_evidence($db, $pending),
    ]);
}
