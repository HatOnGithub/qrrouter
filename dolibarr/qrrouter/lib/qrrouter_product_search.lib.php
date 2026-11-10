<?php
/** Read-only product search metadata, projected with native field visibility. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_search_plain_text($value) {
    $value = preg_replace('/<\/?(?:p|div|li|br|tr|td|th|h[1-6])\b[^>]*>/i', ' ', (string) $value);
    return trim(preg_replace('/\s+/u', ' ', qrr_plain_translation(strip_tags((string) $value))));
}

function qrr_search_field_expression($expression, $default = 1) {
    if ($expression === null || $expression === '') {
        return $default;
    }
    return (int) dol_eval((string) $expression, 1, 1, '2');
}

function qrr_product_search_metadata($db, $products) {
    global $user, $langs;
    if (!$products) {
        return $products;
    }
    require_once DOL_DOCUMENT_ROOT . '/core/class/extrafields.class.php';
    $extra = new ExtraFields($db);
    if ($extra->fetch_name_optionals_label('product') < 0) {
        throw new RuntimeException('Cannot read product extra-field definitions');
    }
    $definitions = $extra->attributes['product'] ?? [];
    $tagsAllowed =
        isModEnabled('category') && (!empty($user->admin) || $user->hasRight('categorie', 'lire'));
    if ($tagsAllowed) {
        require_once DOL_DOCUMENT_ROOT . '/categories/class/categorie.class.php';
    }
    $hadObject = array_key_exists('object', $GLOBALS);
    $previousObject = $GLOBALS['object'] ?? null;
    try {
        foreach ($products as $id => &$row) {
            $row['tags'] = [];
            $row['extrafields'] = (object) [];
            $product = qrr_product($db, $id);
            if (!$product) {
                continue;
            }
            // Native visibility expressions may refer to the current object.
            $GLOBALS['object'] = $product;
            if ($tagsAllowed) {
                $category = new Categorie($db);
                $tags = $category->containing($id, Categorie::TYPE_PRODUCT);
                if (!is_array($tags)) {
                    throw new RuntimeException('Cannot read product tags');
                }
                foreach ($tags as $tag) {
                    if (
                        isset($tag->entity) &&
                        !in_array(
                            (int) $tag->entity,
                            array_map('intval', explode(',', getEntity('category'))),
                            true,
                        )
                    ) {
                        continue;
                    }
                    $label = qrr_search_plain_text($tag->label ?? '');
                    if ($label !== '') {
                        $row['tags'][] = $label;
                    }
                }
                $row['tags'] = array_values(array_unique($row['tags']));
            }
            if (empty($definitions['label'])) {
                continue;
            }
            if ($product->fetch_optionals() < 0) {
                throw new RuntimeException('Cannot read product extra fields');
            }
            $fields = [];
            foreach ($definitions['label'] as $key => $label) {
                $type = $definitions['type'][$key] ?? '';
                if (
                    in_array($type, ['password', 'separate'], true) ||
                    !empty($definitions['hidden'][$key]) ||
                    !qrr_search_field_expression($definitions['enabled'][$key] ?? null) ||
                    !in_array(
                        abs(qrr_search_field_expression($definitions['list'][$key] ?? null)),
                        [1, 2, 3, 4, 5],
                        true,
                    ) ||
                    !qrr_search_field_expression($definitions['perms'][$key] ?? null)
                ) {
                    continue;
                }
                $value = $product->array_options['options_' . $key] ?? null;
                if ($value === null || $value === '') {
                    continue;
                }
                if (is_array($value)) {
                    $value = implode(',', array_filter($value, 'is_scalar'));
                } elseif (!is_scalar($value)) {
                    continue;
                }
                if (!empty($definitions['langfile'][$key])) {
                    $langs->load($definitions['langfile'][$key]);
                }
                $formatted = $extra->showOutputField($key, $value, '', 'product', $langs, $product);
                if ($type === 'boolean') {
                    $formatted = $langs->trans($value ? 'Yes' : 'No');
                }
                $fields[$key] = [
                    'label' => qrr_search_plain_text($langs->trans($label)),
                    'value' => qrr_search_plain_text($formatted),
                ];
            }
            $row['extrafields'] = (object) $fields;
        }
        unset($row);
    } finally {
        if ($hadObject) {
            $GLOBALS['object'] = $previousObject;
        } else {
            unset($GLOBALS['object']);
        }
    }
    return $products;
}
