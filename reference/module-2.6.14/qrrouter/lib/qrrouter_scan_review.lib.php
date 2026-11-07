<?php
/** Compact, selectable scan review. Pure presentation: no stock writes. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

function qrr_scan_review_table($codes, $state, $warehouses, $products = array(), $allowUnknown = false, $action = '') {
    $out = '<div class="qrr-review-toolbar"><label class="qrr-review-all"><input type="checkbox" class="qrr-review-toggle-all" checked> Select all</label><span class="qrr-review-count" aria-live="polite"></span></div>';
    $out .= '<div class="qrr-review-scroll"><table class="qrr-review-table"><thead><tr><th scope="col">Include</th><th scope="col">Item / QR</th><th scope="col">Product / type</th><th scope="col">Location</th><th scope="col">Status / qty</th></tr></thead><tbody>';
    foreach ($codes as $code) {
        $item = $state['items'][$code] ?? null;
        $known = is_array($item);
        if (!$known && !$allowUnknown) continue;
        $selectable = $known;
        if ($known && $action === 'register') $selectable = ($item['type'] ?? '') === 'unassigned';
        elseif ($known && $action === 'checkin') $selectable = !!qrr_loan_data($item);
        elseif ($known && in_array($action, array('move','checkout','consume'), true)) $selectable = qrr_available($item);
        $type = $known ? (string)($item['type'] ?? '') : '';
        $pid = $known ? (int)($item['product_id'] ?? 0) : 0;
        $product = $products[$pid] ?? array();
        $ref = trim((string)($product['ref'] ?? ''));
        $detail = $ref !== '' ? $ref : ($type === 'unassigned' ? 'Unassigned QR label' : ($known ? ucfirst($type) : 'Not in inventory'));
        $wid = $known ? (int)($item['warehouse_id'] ?? 0) : 0;
        $location = $warehouses[$wid]['ref'] ?? ($known ? 'No warehouse' : '—');
        $bin = $known ? trim((string)($item['bin'] ?? '')) : '';
        if ($known && $action === 'checkin' && !empty($item['checkout'])) {
            $originWid = (int)($item['checkout']['origin_warehouse_id'] ?? 0);
            $location = $warehouses[$originWid]['ref'] ?? 'Unknown original';
            $bin = (string)($item['checkout']['origin_bin'] ?? '');
        }
        $status = !$known ? 'Unknown' : ($type === 'unassigned' ? 'Unassigned' : (!empty($item['pending_operation']) || !empty($item['pending_handoff']) ? 'Pending' : (!empty($item['checkout']) ? 'Checked out' : (qrr_item_status($item) === 'consumed' ? 'Consumed' : 'In stock'))));
        $qty = !$known || $type === 'unassigned' ? '—' : ($type === 'box' ? (($item['qty'] ?? null) === null ? 'Unknown' : (string)(int)$item['qty']) : '1');
        $out .= '<tr'.(!$selectable?' class="qrr-review-unknown"':'').'><td><input type="checkbox" class="qrr-review-check" name="selected[]" value="'.qrr_h($code).'"'.($selectable?' checked':' disabled').' aria-label="Include '.qrr_h($code).'"></td>';
        $qrPreview = $known ? '<img src="'.qrr_h(qrr_thumbnail_url($code)).'" width="42" height="42" loading="lazy" alt="QR label">' : '<span class="qrr-review-missing">?</span>';
        $identity = $known ? qrr_item_identity_html($item) : '<span class="qrr-item-identity"><span class="qrr-item-name">'.qrr_h($code).'</span></span>';
        $out .= '<td><div class="qrr-review-identity">'.$qrPreview.$identity.'</div></td>';
        $out .= '<td><strong>'.qrr_h($detail).'</strong><small>'.qrr_h($type === 'unassigned' ? 'Unassigned' : ($known ? ucfirst($type) : 'Unknown QR')).'</small></td>';
        $out .= '<td>'.qrr_h($location).($bin !== ''?'<small>'.qrr_h($bin).'</small>':'').'</td>';
        if ($known && $action === 'consume' && $type === 'box' && isset($item['qty']) && $item['qty'] !== null && (int)$item['qty'] > 0) {
            $quantityHtml = '<label class="qrr-review-qty-label">Consume <input class="qrr-input" type="number" min="1" max="'.(int)$item['qty'].'" name="quantities['.qrr_h($code).']" value="'.(int)$item['qty'].'" style="max-width:90px;padding:6px"></label>';
        } else {
            $quantityHtml = '<small>Qty: '.qrr_h($qty).'</small>';
        }
        $excluded = !$selectable && $known ? '<small>Not eligible for this action</small>' : '';
        $out .= '<td><span class="qrr-review-status">'.qrr_h($status).'</span>'.$quantityHtml.$excluded.'</td></tr>';
    }
    return $out.'</tbody></table></div>';
}
