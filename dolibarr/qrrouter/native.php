<?php
/** Read-only QR references from native Dolibarr cards and location tabs. */
$res = 0;
if (is_file(__DIR__ . '/../../main.inc.php')) {
    $res = include __DIR__ . '/../../main.inc.php';
}
if (!$res) {
    http_response_code(503);
    exit('Dolibarr bootstrap unavailable');
}
require_once __DIR__ . '/lib/qrrouter.lib.php';
require_once __DIR__ . '/lib/qrrouter_related.lib.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (!qrr_inventory_right($user)) {
    accessforbidden();
}
try {
    $kind = (string) GETPOST('kind', 'aZ09');
    $id = (int) GETPOST('id', 'int');
    $target = qrr_related_target($db, $user, $kind, $id);
    $binKey = (string) GETPOST('bin_key', 'alphanohtml');
    if ($binKey !== '' && ($kind !== 'warehouse' || !qrr_locations_right($user))) {
        throw new DomainException('Bin locations are inaccessible');
    }
    $view = qrr_browser_inventory($db);
    $items = qrr_related_items($view['state']['items'], $kind, $id);
    $bins = [];
    foreach ($items as $item) {
        if (!empty($item['bin_key'])) {
            $bins[$item['bin_key']] = $item['bin'];
        }
    }
    natcasesort($bins);
    if ($binKey !== '') {
        $items = array_filter($items, fn($item) => ($item['bin_key'] ?? '') === $binKey);
    }
    uasort(
        $items,
        fn($a, $b) => strnatcasecmp($a['label'] ?: $a['code'], $b['label'] ?: $b['code']),
    );
    $total = count($items);
    $pages = max(1, (int) ceil($total / 50));
    $page = max(1, min($pages, (int) GETPOST('page', 'int')));
    $items = array_slice($items, ($page - 1) * 50, 50, true);
    $head = qrr_related_head($target);
} catch (DomainException $error) {
    accessforbidden();
} catch (InvalidArgumentException $error) {
    http_response_code(400);
    exit(qrr_h($error->getMessage()));
} catch (Throwable $error) {
    dol_syslog('QR Router native references: ' . $error->getMessage(), LOG_ERR);
    http_response_code(503);
    llxHeader('', qrr_t('QR entries'));
    print '<p class="error">' . qrr_h(qrr_t('QR inventory is temporarily unavailable.')) . '</p>';
    llxFooter();
    exit();
}

// Use the native shell, retaining the warehouse/product navigation and extension tabs.
$langs->load('qrrouter@qrrouter');
llxHeader('', qrr_t('QR entries') . ' - ' . $target['ref']);
if ($head) {
    print dol_get_fiche_head($head, 'qrrouter', qrr_t('QR entries'), -1, 'barcode');
}
print '<h1>' . qrr_h(qrr_t('QR entries')) . ': ' . qrr_h($target['ref']) . '</h1>';
print '<p><a href="' . qrr_h($target['url']) . '">' . qrr_h(qrr_t('Back to native card')) . '</a>';
if ($target['locations_url'] !== '') {
    print ' &middot; <a href="' .
        qrr_h($target['locations_url']) .
        '">' .
        qrr_h(qrr_t('QR Router locations')) .
        '</a>';
}
print ' &middot; <a href="' .
    qrr_h(qrr_app_link('inventory')) .
    '">' .
    qrr_h(qrr_t('Inventory')) .
    '</a></p>';
if ($kind === 'warehouse' && $bins && qrr_locations_right($user)) {
    print '<form method="get"><input type="hidden" name="kind" value="warehouse"><input type="hidden" name="id" value="' .
        $id .
        '">';
    print '<label>' .
        qrr_h(qrr_t('QR Router locations')) .
        ' <select class="flat" name="bin_key"><option value="">' .
        qrr_h(qrr_t('All locations')) .
        '</option>';
    foreach ($bins as $key => $label) {
        print '<option value="' .
            qrr_h($key) .
            '"' .
            ($binKey === (string) $key ? ' selected' : '') .
            '>' .
            qrr_h($label) .
            '</option>';
    }
    print '</select></label> <button class="button" type="submit">' .
        qrr_h(qrr_t('Filter')) .
        '</button></form>';
}
print '<p>' . qrr_h(qrr_t('QR entries')) . ': ' . $total . '</p>';
print '<div class="div-table-responsive"><table class="noborder centpercent"><thead><tr class="liste_titre">';
foreach (
    ['Item / QR', 'Product', 'Dolibarr lot/serial', 'Warehouse', 'Location', 'Quantity', 'Status']
    as $label
) {
    print '<th>' . qrr_h(qrr_t($label)) . '</th>';
}
print '</tr></thead><tbody>';
foreach ($items as $code => $item) {
    $pid = (int) $item['product_id'];
    $wid = (int) $item['warehouse_id'];
    $lot = (int) ($item['product_lot_id'] ?? 0);
    $status =
        !empty($item['pending_operation']) || !empty($item['pending_handoff'])
            ? 'Pending'
            : (isset($item['checkout'])
                ? 'On loan'
                : ($item['status'] === 'consumed'
                    ? 'Consumed'
                    : 'In stock'));
    print '<tr class="oddeven"><td><a href="' .
        qrr_h(qrr_app_link('items/' . rawurlencode($code))) .
        '">' .
        qrr_h($item['label'] ?: $code) .
        '</a><br><span class="opacitymedium">' .
        qrr_h($code) .
        '</span></td>';
    print '<td><a href="' .
        qrr_h(dol_buildpath('/product/card.php', 1) . '?id=' . $pid) .
        '">' .
        qrr_h($view['products'][$pid]['ref'] ?? '') .
        '</a></td>';
    print '<td>' .
        ($lot > 0
            ? '<a href="' .
                qrr_h(dol_buildpath('/product/stock/productlot_card.php', 1) . '?id=' . $lot) .
                '">' .
                qrr_h($item['native_batch'] ?? '') .
                '</a>'
            : '') .
        '</td>';
    print '<td><a href="' .
        qrr_h(dol_buildpath('/product/stock/card.php', 1) . '?id=' . $wid) .
        '">' .
        qrr_h($view['warehouses'][$wid]['ref'] ?? '') .
        '</a></td>';
    print '<td>';
    if (!empty($item['bin_key']) && qrr_locations_right($user)) {
        print '<a href="' .
            qrr_h(qrr_related_url('warehouse', $wid, ['bin_key' => $item['bin_key']])) .
            '">' .
            qrr_h($item['bin']) .
            '</a>';
    } else {
        print qrr_h($item['bin'] ?? '');
    }
    if (qrr_write_right($user)) {
        print ' <a href="' .
            qrr_h(qrr_app_link('edit/' . $code)) .
            '">' .
            qrr_h(qrr_t('Change location')) .
            '</a>';
    }
    print '</td><td>' .
        qrr_h($item['qty'] ?? '?') .
        '</td><td>' .
        qrr_h(qrr_t($status)) .
        '</td></tr>';
}
if (!$items) {
    print '<tr><td colspan="7">' . qrr_h(qrr_t('No related QR entries.')) . '</td></tr>';
}
print '</tbody></table></div>';
if ($page > 1) {
    print '<a class="butAction" href="' .
        qrr_h(qrr_related_url($kind, $id, ['bin_key' => $binKey, 'page' => $page - 1])) .
        '">' .
        qrr_h(qrr_t('Previous')) .
        '</a> ';
}
if ($page < $pages) {
    print '<a class="butAction" href="' .
        qrr_h(qrr_related_url($kind, $id, ['bin_key' => $binKey, 'page' => $page + 1])) .
        '">' .
        qrr_h(qrr_t('Next')) .
        '</a>';
}
if ($head) {
    print dol_get_fiche_end();
}
llxFooter();
