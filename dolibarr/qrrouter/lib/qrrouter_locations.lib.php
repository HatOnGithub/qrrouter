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
        'code' => $item['code'] ?? '',
        'warehouse_id' => (int) $warehouseId,
        'levels' => (object) ($item['bin_values'] ?? []),
        'warehouses' => (object) qrr_warehouses($db),
    ]);
}

/** Location labels encode level identities and values, independently of display formatting. */
function qrr_location_qr($warehouseId, $values) {
    global $conf;
    return 'QRRLOC:1:' .
        (int) $conf->entity .
        ':' .
        (int) $warehouseId .
        ':' .
        rtrim(
            strtr(base64_encode(json_encode((object) $values, JSON_THROW_ON_ERROR)), '+/', '-_'),
            '=',
        );
}
function qrr_absolute_app_url($route, $params) {
    $url = qrr_app_link($route, $params);
    if (preg_match('~^https?://~', $url)) {
        return $url;
    }
    $root = parse_url(DOL_MAIN_URL_ROOT);
    return $root['scheme'] .
        '://' .
        $root['host'] .
        (isset($root['port']) ? ':' . $root['port'] : '') .
        $url;
}
function qrr_location_qr_url($payload) {
    return qrr_absolute_app_url('locations', ['location' => $payload]);
}
/** A scanned payload identifies a choice; recheck entity/access and current level definitions. */
function qrr_resolve_location_qr($db, $payload) {
    global $conf;
    if (
        strlen($payload) > 4096 ||
        !preg_match(
            '/^QRRLOC:1:([1-9][0-9]{0,8}):([1-9][0-9]{0,8}):([A-Za-z0-9_-]+)$/D',
            $payload,
            $match,
        )
    ) {
        throw new InvalidArgumentException('Scan a QR Router location label');
    }
    if ((int) $match[1] !== (int) $conf->entity) {
        throw new DomainException('Location belongs to another entity');
    }
    $wid = (int) $match[2];
    if (!isset(qrr_warehouses($db)[$wid])) {
        throw new DomainException('Location warehouse is unavailable');
    }
    $decoded = base64_decode(strtr($match[3], '-_', '+/'), true);
    $values = $decoded === false ? null : json_decode($decoded, true, 8, JSON_THROW_ON_ERROR);
    if (!is_array($values) || !$values) {
        throw new InvalidArgumentException('Location label has no location levels');
    }
    $choice = qrr_location_choice($db, $wid, $values);
    if (!$choice['bin_key'] || count((array) $choice['bin_values']) !== count($values)) {
        throw new InvalidArgumentException(
            'Location label does not match the current location configuration',
        );
    }
    return [
        'warehouse_id' => $wid,
        'levels' => (object) $choice['bin_values'],
        'bin' => $choice['bin'],
        'label' => qrr_location_local_label($db, $wid, $choice),
    ];
}
