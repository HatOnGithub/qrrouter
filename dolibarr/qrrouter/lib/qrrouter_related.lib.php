<?php
/** Native-object navigation and read-only QR associations. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_related_url($kind, $id, $extra = []) {
    return dol_buildpath('/qrrouter/native.php', 1) .
        '?' .
        http_build_query(array_merge(['kind' => $kind, 'id' => (int) $id], $extra));
}

/** Validate the native object before consulting QR inventory, including empty result sets. */
function qrr_related_target($db, $user, $kind, $id) {
    if (!qrr_inventory_right($user) || $id < 1) {
        throw new DomainException('Native object is inaccessible');
    }
    $object = null;
    if ($kind === 'product') {
        $object = qrr_product($db, $id);
        if (!$object || !qrr_native_read_access($user, 'produit', $id, 'product&product')) {
            throw new DomainException('Native object is inaccessible');
        }
        $ref = $object->ref;
        $path = '/product/card.php';
    } elseif ($kind === 'warehouse') {
        $warehouses = qrr_warehouses($db);
        if (
            !isset($warehouses[$id]) ||
            !qrr_native_read_access($user, 'stock', $id, 'entrepot&stock')
        ) {
            throw new DomainException('Native object is inaccessible');
        }
        require_once DOL_DOCUMENT_ROOT . '/product/stock/class/entrepot.class.php';
        $object = new Entrepot($db);
        if ($object->fetch($id) <= 0) {
            throw new DomainException('Native object is inaccessible');
        }
        $ref = $warehouses[$id]['ref'];
        $path = '/product/stock/card.php';
    } elseif ($kind === 'lot') {
        require_once DOL_DOCUMENT_ROOT . '/product/stock/class/productlot.class.php';
        $object = new Productlot($db);
        if (
            $object->fetch($id) <= 0 ||
            !in_array(
                (int) $object->entity,
                array_map('intval', explode(',', getEntity('productbatch'))),
                true,
            ) ||
            !qrr_product($db, (int) $object->fk_product) ||
            !qrr_native_read_access($user, 'produit', (int) $object->fk_product, 'product&product')
        ) {
            throw new DomainException('Native object is inaccessible');
        }
        $ref = $object->batch;
        $path = '/product/stock/productlot_card.php';
    } elseif ($kind === 'user') {
        $users = qrr_personal_users($db);
        if (!qrr_user_visible($user, $id) || !isset($users[$id])) {
            throw new DomainException('Native object is inaccessible');
        }
        $ref = $users[$id];
        $path = '/user/card.php';
    } elseif (in_array($kind, ['salesorder', 'production', 'shipment'], true)) {
        qrr_check_reference($db, $user, $kind, $id);
        $references = qrr_consumption_references($db, $user, [
            [
                'consumption_log' => [['reference_type' => $kind, 'reference_id' => $id]],
            ],
        ]);
        $reference = $references[$kind . ':' . $id] ?? null;
        if (!$reference) {
            throw new DomainException('Native object is inaccessible');
        }
        return [
            'kind' => $kind,
            'id' => $id,
            'ref' => $reference['ref'],
            'url' => $reference['url'],
            'object' => null,
            'locations_url' => '',
        ];
    } else {
        throw new InvalidArgumentException('Unknown native object type');
    }
    return [
        'kind' => $kind,
        'id' => $id,
        'ref' => (string) $ref,
        'object' => $object,
        'url' => dol_buildpath($path, 1) . '?id=' . $id,
        'locations_url' =>
            $kind === 'warehouse'
                ? qrr_app_link('locations', ['warehouse_id' => $id])
                : qrr_related_url($kind, $id),
    ];
}

/** Input must be the authorized browser projection, never a raw service snapshot. */
function qrr_related_items($items, $kind, $id) {
    return array_filter($items, function ($item) use ($kind, $id) {
        switch ($kind) {
            case 'product':
                return (int) $item['product_id'] === $id;
            case 'warehouse':
                return (int) $item['warehouse_id'] === $id;
            case 'lot':
                return (int) ($item['product_lot_id'] ?? 0) === $id;
            case 'user':
                return (int) (((array) ($item['checkout'] ?? []))['user_id'] ?? 0) === $id;
            case 'salesorder':
            case 'production':
            case 'shipment':
                foreach ($item['consumption_log'] ?? [] as $entry) {
                    if (
                        ($entry['reference_type'] ?? '') === $kind &&
                        (int) ($entry['reference_id'] ?? 0) === $id
                    ) {
                        return true;
                    }
                }
        }
        return false;
    });
}

/** Keep the native tab strip, including other installed warehouse extensions. */
function qrr_related_head($target) {
    if ($target['kind'] === 'warehouse') {
        require_once DOL_DOCUMENT_ROOT . '/core/lib/stock.lib.php';
        return stock_prepare_head($target['object']);
    }
    if (in_array($target['kind'], ['product', 'lot'], true)) {
        require_once DOL_DOCUMENT_ROOT . '/core/lib/product.lib.php';
        return $target['kind'] === 'product'
            ? product_prepare_head($target['object'])
            : productlot_prepare_head($target['object']);
    }
    return [];
}
