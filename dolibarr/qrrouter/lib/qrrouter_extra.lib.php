<?php
/** C# aggregation queries and native order picking facts. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

/** Produce individual tracked rows, and one total per product for generic items and boxes.
 * Unknown box quantities have their own count and never contribute to summed totals.
 */
function qrr_bin_summary($items, $wid, $bin, $products = [], $levelId = 0, $levelValue = '') {
    $summary = qrr_command('query-bin-summary', [
        'warehouse_id' => (int) $wid,
        'bin' => (string) $bin,
        'level_id' => (int) $levelId,
        'level_value' => (string) $levelValue,
        'products' => (object) $products,
        'visible_codes' => qrr_item_codes(
            array_filter(
                $items,
                fn($item) => (int) $item['warehouse_id'] === (int) $wid &&
                    ($bin === '' || (string) $item['bin'] === (string) $bin),
            ),
        ),
    ]);
    // The service aggregates internal records. Rebuild rows from the authorized browser fields.
    $summary['tracked'] = array_values(
        array_map(function ($row) use ($items, $products) {
            $item = $items[$row['code']];
            $item['_product'] = $products[(int) $item['product_id']] ?? [
                'ref' => '',
                'label' => '',
            ];
            return $item;
        }, array_filter($summary['tracked'], fn($row) => isset($items[$row['code']]))),
    );
    return $summary;
}
function qrr_known_bins($items, $wid) {
    return qrr_command('query-known-bins', [
        'warehouse_id' => (int) $wid,
        'visible_codes' => qrr_item_codes(array_filter($items, fn($item) => !empty($item['bin']))),
    ]);
}
function qrr_warehouse_summary($items, $wid) {
    return qrr_command('query-warehouse-summary', [
        'warehouse_id' => (int) $wid,
        'visible_codes' => qrr_item_codes($items),
    ]);
}
/** Read native requirements after record authorization; browsers cannot author trusted order lines. */
function qrr_order_lines($db, $id, $type = 'salesorder') {
    global $user;
    if ($id <= 0) {
        throw new InvalidArgumentException('Select an order');
    }
    if (!in_array($type, ['salesorder', 'production'], true)) {
        throw new InvalidArgumentException('Unsupported picking source');
    }
    if (!qrr_reference_visible($user, $type, $id)) {
        throw new DomainException('Order is inaccessible');
    }
    if ($type === 'production') {
        require_once DOL_DOCUMENT_ROOT . '/mrp/class/mo.class.php';
        $cmd = new Mo($db);
    } else {
        require_once DOL_DOCUMENT_ROOT . '/commande/class/commande.class.php';
        $cmd = new Commande($db);
    }
    if ($cmd->fetch($id) <= 0) {
        throw new RuntimeException('Order not found');
    }
    if ((int) $cmd->entity !== (int) $GLOBALS['conf']->entity) {
        throw new RuntimeException('Order outside current entity');
    }
    $result = $type === 'production' ? $cmd->fetchLines() : $cmd->fetch_lines();
    if ($result < 0) {
        throw new RuntimeException('Order lines unavailable');
    }
    $out = [];
    foreach ($cmd->lines as $line) {
        // MO quantities already describe the planned component requirements.
        // Output products and recorded consumption/production are not pick demands.
        if ($type === 'production' && ($line->role ?? '') !== 'toconsume') {
            continue;
        }
        $pid = (int) ($line->fk_product ?? 0);
        if (!$pid) {
            continue;
        }
        $qty = (float) ($line->qty ?? 0);
        if ($qty <= 0) {
            continue;
        }
        $out[] = [
            'product_id' => $pid,
            'qty' => $qty,
            'ref' => (string) ($line->product_ref ?? ''),
            'label' => (string) ($line->product_label ?? ($line->desc ?? '')),
        ];
    }
    return ['order' => $cmd, 'lines' => $out];
}
/** Greedy allocation by existing bin code, tracked individually; independent stock amounts (no reservations). */
function qrr_pick_proposal($lines, $items, $wid, $products, $orderId = 0) {
    return qrr_command('query-pick', [
        'lines' => $lines,
        'order_id' => (int) $orderId,
        'warehouse_id' => (int) $wid,
        'products' => (object) $products,
        'visible_codes' => qrr_item_codes($items),
    ]);
}
