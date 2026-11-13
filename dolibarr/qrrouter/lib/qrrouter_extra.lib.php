<?php
/** C# aggregation queries and native order picking facts. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

/** Produce individual tracked rows, and one total per product for generic items and boxes.
 * Unknown box quantities have their own count and never contribute to summed totals.
 */
function qrr_bin_summary($items, $wid, $bin, $products = []) {
    $summary = qrr_command('query-bin-summary', [
        'warehouse_id' => (int) $wid,
        'bin' => (string) $bin,
        'products' => (object) $products,
        'visible_codes' => array_keys($items),
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
        'visible_codes' => array_keys($items),
    ]);
}
function qrr_warehouse_summary($items, $wid) {
    return qrr_command('query-warehouse-summary', [
        'warehouse_id' => (int) $wid,
        'visible_codes' => array_keys($items),
    ]);
}
function qrr_order_lines($db, $id) {
    global $user;
    if ($id <= 0) {
        return [];
    }
    if (!qrr_reference_visible($user, 'salesorder', $id)) {
        throw new DomainException('Customer order is inaccessible');
    }
    require_once DOL_DOCUMENT_ROOT . '/commande/class/commande.class.php';
    $cmd = new Commande($db);
    if ($cmd->fetch($id) <= 0) {
        throw new RuntimeException('Order not found');
    }
    if ((int) $cmd->entity !== (int) $GLOBALS['conf']->entity) {
        throw new RuntimeException('Order outside current entity');
    }
    $cmd->fetch_lines();
    $out = [];
    foreach ($cmd->lines as $line) {
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
function qrr_pick_proposal($lines, $items, $wid, $products) {
    return qrr_command('query-pick', [
        'lines' => $lines,
        'warehouse_id' => (int) $wid,
        'products' => (object) $products,
        'visible_codes' => array_keys($items),
    ]);
}
