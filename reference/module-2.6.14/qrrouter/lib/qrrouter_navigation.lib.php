<?php
/** Responsive QR Router navigation. Routes are filtered using page-equivalent permissions. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

function qrr_nav_sections($user) {
    $canRead = qrr_read_right($user);
    $canProducts = qrr_products_right($user);
    $canWrite = qrr_write_right($user);
    $canOrders = qrr_orders_right($user);
    return array(
        'primary' => array(
            array('id'=>'scan', 'label'=>'Scan QR', 'path'=>'camera.php', 'show'=>$canRead),
            array('id'=>'inventory', 'label'=>'Inventory', 'path'=>'index.php', 'show'=>$canRead && $canProducts),
            array('id'=>'register', 'label'=>'Register', 'path'=>'register.php', 'show'=>$canWrite && $canProducts),
            array('id'=>'move', 'label'=>'Move', 'path'=>'workflow.php?action=move', 'show'=>$canWrite && $canProducts),
        ),
        'stock' => array(
            array('id'=>'checkout', 'label'=>'Check out', 'path'=>'workflow.php?action=checkout', 'show'=>$canWrite && $canProducts),
            array('id'=>'checkin', 'label'=>'Check in', 'path'=>'workflow.php?action=checkin', 'show'=>$canWrite && $canProducts),
            array('id'=>'consume', 'label'=>'Consume', 'path'=>'workflow.php?action=consume', 'show'=>$canWrite && $canProducts),
            array('id'=>'return', 'label'=>'Return consumed item', 'path'=>'return.php', 'show'=>$canWrite && $canProducts),
            array('id'=>'loans', 'label'=>'Checked-out items', 'path'=>'loans.php', 'show'=>$canRead && $canProducts),
            array('id'=>'pick', 'label'=>'Pick sheet', 'path'=>'pick.php', 'show'=>$canRead && $canProducts && $canOrders),
        ),
        'labels' => array(
            array('id'=>'print', 'label'=>'Print QR labels', 'path'=>'print_codes.php', 'show'=>$canWrite),
            array('id'=>'batches', 'label'=>'Unregistered QR batches', 'path'=>'batches.php', 'show'=>$canRead),
            array('id'=>'bins', 'label'=>'Bin printouts', 'path'=>'bins.php', 'show'=>$canRead && $canProducts),
            array('id'=>'binloc', 'label'=>'Local Binloc labels', 'path'=>'binloc_labels.php', 'show'=>$canWrite && $canProducts),
        ),
        'tools' => array(
            array('id'=>'manualinput', 'label'=>'Enter QR codes manually', 'path'=>'manual.php', 'show'=>$canRead),
            array('id'=>'manual', 'label'=>'Create QR item manually', 'path'=>'manage.php', 'show'=>$canWrite && $canProducts),
            array('id'=>'bulk', 'label'=>'Bulk create / copy', 'path'=>'bulk.php', 'show'=>$canWrite && $canProducts),
            array('id'=>'people', 'label'=>'Personal warehouses', 'path'=>'people.php', 'show'=>!empty($user->admin)),
        ),
    );
}

/** Pure helper for highlighting the active workflow, without relying on JS or CSS selectors. */
function qrr_nav_active_id($script, $action = '') {
    $script = basename((string) parse_url((string)$script, PHP_URL_PATH));
    if ($script === 'workflow.php') {
        return in_array($action, array('move', 'checkout', 'checkin', 'consume'), true) ? $action : '';
    }
    $map = array(
        'camera.php'=>'scan', 'scan.php'=>'scan', 'index.php'=>'inventory', 'register.php'=>'register',
        'print_codes.php'=>'print', 'batch_print.php'=>'batches', 'batches.php'=>'batches',
        'bins.php'=>'bins', 'bin_print.php'=>'bins', 'binloc_labels.php'=>'binloc',
        'return.php'=>'return', 'loans.php'=>'loans', 'checkout.php'=>'checkout', 'transfer.php'=>'move', 'label.php'=>'print', 'pick.php'=>'pick',
        'manual.php'=>'manualinput', 'manage.php'=>'manual', 'bulk.php'=>'bulk', 'people.php'=>'people',
        'register_summary.php'=>'register',
    );
    return $map[$script] ?? '';
}

function qrr_nav_allowed($section) {
    return array_values(array_filter($section, function($item){return $item['show'];}));
}

function qrr_nav_link_html($item, $active, $class = 'qrr-nav-link') {
    $current = $item['id'] === $active;
    return '<a class="'.qrr_h($class).($current?' is-current':'').'" href="'.qrr_h(qrr_base().$item['path']).'"'.($current?' aria-current="page"':'').'>'.qrr_h(qrr_t($item['label'])).'</a>';
}

function qrr_nav_html($user, $script = '', $action = '') {
    $sections = qrr_nav_sections($user);
    foreach ($sections as $name => $section) $sections[$name] = qrr_nav_allowed($section);
    $active = qrr_nav_active_id($script, $action);
    $labels = array('primary'=>'Quick actions', 'stock'=>'Stock actions', 'labels'=>'Labels & locations', 'tools'=>'More tools');
    $html = '<nav class="qrr-nav qrr-noprint" aria-label="QR Product Router navigation">';
    $html .= '<div class="qrr-nav-header"><a class="qrr-nav-brand" href="'.qrr_h(qrr_base().'index.php').'"><span class="qrr-nav-mark" aria-hidden="true">QR</span><span>Product Router</span></a>';
    $html .= '<div class="qrr-nav-mobile-actions">';
    foreach ($sections['primary'] as $item) if ($item['id'] === 'scan') $html .= qrr_nav_link_html($item, $active, 'qrr-nav-scan');
    $html .= '<details class="qrr-nav-mobile-menu"><summary class="qrr-nav-menu-toggle"><span aria-hidden="true" class="qrr-nav-hamburger">&#9776;</span> '.qrr_h(qrr_t('Menu')).'</summary>';
    $html .= '<div class="qrr-nav-mobile-panel" role="group" aria-label="All QR Router actions">';
    foreach ($sections as $group => $items) {
        if (!$items) continue;
        $html .= '<div class="qrr-nav-mobile-section"><div class="qrr-nav-section-title">'.qrr_h(qrr_t($labels[$group])).'</div>';
        foreach ($items as $item) $html .= qrr_nav_link_html($item, $active, 'qrr-nav-mobile-link');
        $html .= '</div>';
    }
    $html .= '</div></details></div></div>';
    $html .= '<div class="qrr-nav-desktop">';
    foreach ($sections['primary'] as $item) $html .= qrr_nav_link_html($item, $active, 'qrr-nav-link'.($item['id']==='scan'?' qrr-nav-primary':''));
    foreach (array('stock', 'labels', 'tools') as $group) {
        $items = $sections[$group];
        if (!$items) continue;
        $hasActive = false;
        foreach ($items as $item) if ($item['id'] === $active) $hasActive = true;
        $html .= '<details class="qrr-nav-dropdown'.($hasActive?' has-current':'').'"><summary class="qrr-nav-dropdown-toggle">'.qrr_h(qrr_t($labels[$group])).'<span class="qrr-nav-chevron" aria-hidden="true"></span></summary>';
        $html .= '<div class="qrr-nav-popover" role="group" aria-label="'.qrr_h(qrr_t($labels[$group])).'">';
        foreach ($items as $item) $html .= qrr_nav_link_html($item, $active, 'qrr-nav-popover-link');
        $html .= '</div></details>';
    }
    $html .= '</div></nav>';
    return $html;
}
