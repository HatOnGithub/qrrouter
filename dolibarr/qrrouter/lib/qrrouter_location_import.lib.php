<?php
/** Optional one-time import. Normal QR Router operation never loads Binloc classes. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}
function qrr_location_import($db) {
    $levelPath = dol_buildpath('/binloc/class/binlocwarehouselevel.class.php', 0);
    $locationPath = dol_buildpath('/binloc/class/binlocproductlocation.class.php', 0);
    if (!is_file($levelPath) || !is_file($locationPath)) {
        throw new RuntimeException(
            'Binloc is not available for import. Existing saved QR locations remain available.',
        );
    }
    require_once $levelPath;
    require_once $locationPath;
    require_once dol_buildpath('/binloc/lib/binloc.lib.php', 0);
    $warehouses = qrr_warehouses($db);
    $configurations = [];
    foreach ($warehouses as $wid => $warehouse) {
        $levels = (new BinlocWarehouseLevel($db))->fetchByWarehouse((int) $wid);
        if (!is_array($levels)) {
            throw new RuntimeException('Cannot import warehouse locations');
        }
        if (!$levels) {
            continue;
        }
        $entries = [];
        foreach ($levels as $id => $cfg) {
            $options = [];
            foreach ($cfg->options ?? [] as $option) {
                if ((int) $option->active === 1) {
                    $options[] = ['id' => (int) $option->id, 'value' => (string) $option->value];
                }
            }
            $entries[] = [
                'id' => (int) $id,
                'label' => (string) $cfg->label,
                'datatype' => (string) $cfg->datatype,
                'options' => $options,
            ];
        }
        $layout = binloc_get_label_layout($db, (int) $wid, (int) array_key_last($levels));
        $configurations[(string) $wid] = [
            'levels' => $entries,
            'separator' => (string) $layout->code_sep,
            'show_warehouse' => !empty($layout->show_warehouse),
        ];
    }
    $assignments = [];
    foreach (qrr_browser_inventory($db)['state']['items'] as $code => $item) {
        if (empty($item['product_lot_id'])) {
            continue;
        }
        $location = new BinlocProductLocation($db);
        $found = $location->fetchAnyByLot((int) $item['product_lot_id']);
        if ($found < 0) {
            throw new RuntimeException('Cannot import lot location');
        }
        if ($found === 0) {
            continue;
        }
        if (
            (int) $location->fk_product !== (int) $item['product_id'] ||
            (int) $location->fk_entrepot !== (int) $item['warehouse_id']
        ) {
            throw new RuntimeException(
                'Resolve Binloc and stock warehouse differences before importing',
            );
        }
        $values = [];
        foreach ($location->values as $id => $value) {
            $values[(string) $id] = !empty($value->fk_option)
                ? (int) $value->fk_option
                : (string) $value->value;
        }
        $assignments[$code] = [
            'warehouse_id' => (int) $item['warehouse_id'],
            'levels' => (object) $values,
        ];
    }
    return [
        'configurations' => (object) $configurations,
        'assignments' => (object) $assignments,
        'warehouses' => (object) $warehouses,
    ];
}
