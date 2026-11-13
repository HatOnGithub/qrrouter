<?php
/** Thin adapter for entity-scoped location rules owned by the C# service. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}
function qrr_location_levels($db, $warehouseId) {
    return qrr_service('POST', 'query-location-levels', ['warehouse_id' => (int) $warehouseId]);
}
function qrr_location_choice($db, $warehouseId, $posted, $previous = null, $keepLegacy = false) {
    if (
        $keepLegacy &&
        $previous &&
        (int) $previous['warehouse_id'] === (int) $warehouseId &&
        empty($previous['bin_values'])
    ) {
        return array_intersect_key($previous, array_flip(['bin', 'bin_key', 'bin_values']));
    }
    return qrr_service('POST', 'query-location-choice', [
        'warehouse_id' => (int) $warehouseId,
        'levels' => (object) $posted,
        'warehouses' => (object) qrr_warehouses($db),
    ]);
}
function qrr_location_local_label($db, $warehouseId, $item, $state = null) {
    return qrr_service('POST', 'query-location-label', [
        'code' => $item['code'],
        'warehouses' => (object) qrr_warehouses($db),
    ]);
}
