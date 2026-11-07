<?php
/** Read-only integration with Binloc's warehouse-level configuration. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

/** @return array Ordered active Binloc level configs. */
function qrr_binloc_levels($db, $warehouseId) {
    if ($warehouseId < 1) return array();
    $path = dol_buildpath('/binloc/class/binlocwarehouselevel.class.php', 0);
    if (!is_string($path) || !is_file($path)) {
        throw new RuntimeException('Binloc is not installed. Enable Binloc to select warehouse levels.');
    }
    require_once $path;
    $model = new BinlocWarehouseLevel($db);
    $levels = $model->fetchByWarehouse((int)$warehouseId);
    if (!is_array($levels)) throw new RuntimeException('Binloc warehouse level lookup failed');
    return $levels;
}

/**
 * Normalize the warehouse-specific POST values against the actual Binloc
 * configuration. Select values use Binloc option rowids; text/numeric values
 * are validated without creating a product->bin assignment in Binloc.
 * Returns raw values, stable key, and a code (without warehouse prefix).
 */
function qrr_binloc_parse_levels($levels, $raw) {
    if (!is_array($raw)) throw new RuntimeException('Invalid location level data');
    $selected = array(); $keyParts = array(); $displayParts = array();
    $hasGap = false;
    foreach ($levels as $id => $cfg) {
        $id = (int)$id;
        $value = isset($raw[$id]) && !is_array($raw[$id]) ? trim((string)$raw[$id]) : '';
        if ($value === '') {
            $hasGap = true;
            continue;
        }
        if ($hasGap) throw new RuntimeException('Choose the Binloc levels in order, without gaps');
        if ($cfg->datatype === 'list' || $cfg->datatype === 'letter') {
            if (!ctype_digit($value)) throw new RuntimeException('Invalid option for '.$cfg->label);
            $found = null;
            foreach ($cfg->options as $opt) {
                if ((int)$opt->id === (int)$value && (int)$opt->active === 1) { $found = $opt; break; }
            }
            if (!$found) throw new RuntimeException('Binloc option is inactive or not available: '.$cfg->label);
            $selected[$id] = (int)$found->id;
            $keyParts[] = $id.':o'.(int)$found->id;
            $displayParts[] = (string)$found->value;
        } else {
            if (strlen($value) > 64 || preg_match('/[<>\x00-\x1f]/', $value)) throw new RuntimeException('Invalid value for '.$cfg->label);
            if ($cfg->datatype === 'number' && !is_numeric($value)) throw new RuntimeException('Numeric value required for '.$cfg->label);
            $selected[$id] = $value;
            $keyParts[] = $id.':v'.(function_exists('dol_strtolower') ? dol_strtolower($value) : strtolower($value));
            $displayParts[] = $value;
        }
    }
    return array('values'=>$selected, 'key'=>implode('|',$keyParts), 'parts'=>$displayParts);
}

/** Compute location display using the same warehouse-prefix and separator configuration as Binloc labels. */
function qrr_binloc_display_code($db, $warehouseId, $levels, $parts) {
    if (!$parts) return '';
    $path = dol_buildpath('/binloc/lib/binloc.lib.php', 0);
    if (!is_string($path) || !is_file($path)) throw new RuntimeException('Binloc library unavailable');
    require_once $path;
    $lastLevel = (int)array_key_last($levels);
    $layout = binloc_get_label_layout($db, (int)$warehouseId, $lastLevel);
    $sep = (string)$layout->code_sep;
    $prefix = (!empty($layout->show_warehouse) ? binloc_get_warehouse_code($db, (int)$warehouseId) : '');
    return ($prefix !== '' ? $prefix.$sep : '').implode($sep, $parts);
}

/** Build an immutable per-item location to save in QR Router, not in Binloc. */
function qrr_binloc_choice($db, $warehouseId, $posted, $previous = null, $keepLegacy = false) {
    if (!$warehouseId) return array('bin'=>'', 'bin_key'=>'', 'bin_values'=>array());
    $levels = qrr_binloc_levels($db, $warehouseId);
    if (!$levels) {
        if (is_array($posted) && count(array_filter($posted, function ($v) { return $v !== ''; }))) {
            throw new RuntimeException('The selected warehouse has no Binloc levels');
        }
        if ($keepLegacy && $previous && (int)$previous['warehouse_id'] === (int)$warehouseId && empty($previous['bin_values'])) {
            return array('bin'=>(string)$previous['bin'], 'bin_key'=>'', 'bin_values'=>array());
        }
        return array('bin'=>'', 'bin_key'=>'', 'bin_values'=>array());
    }
    $choice = qrr_binloc_parse_levels($levels, $posted);
    if (!$choice['values']) {
        if ($keepLegacy && $previous && (int)$previous['warehouse_id'] === (int)$warehouseId && empty($previous['bin_values'])) {
            return array('bin'=>(string)$previous['bin'], 'bin_key'=>'', 'bin_values'=>array());
        }
        return array('bin'=>'', 'bin_key'=>'', 'bin_values'=>array());
    }
    $bin = qrr_binloc_display_code($db, $warehouseId, $levels, $choice['parts']);
    if (!qrr_bin_valid($bin)) throw new RuntimeException('Binloc location code exceeds the QR Router limit');
    return array('bin'=>$bin, 'bin_key'=>$choice['key'], 'bin_values'=>$choice['values']);
}

/**
 * A local location label is purely presentational: bin/bin_key/bin_values remain
 * authoritative for movements, summaries, and native warehouse reconciliation.
 * Configured per Dolibarr warehouse in QR Router's entity-scoped state.
 */
function qrr_binloc_label_settings($warehouseId, $state = null) {
    if ($state === null) $state = qrr_load_state();
    $entry = $state['binloc_label_settings'][(string)(int)$warehouseId] ?? null;
    return is_array($entry) && !empty($entry['enabled']) ? $entry : null;
}

/** Validate and normalize POSTed settings against active Binloc level IDs. */
function qrr_binloc_validate_label_settings($levels, $posted) {
    if (!is_array($posted)) throw new RuntimeException('Invalid Binloc label settings');
    $enabled = array(); $separators = array();
    $all = array_keys($levels);
    if (!$all) throw new RuntimeException('Configure Binloc levels before customizing local labels');
    foreach ($levels as $id => $cfg) {
        $id = (string)(int)$id;
        if (isset($posted['show'][$id])) $enabled[$id] = 1;
        $rawSeparator = $posted['separator'][$id] ?? '-';
        if (!is_string($rawSeparator)) throw new RuntimeException('Invalid separator for '.$cfg->label);
        $separator = $rawSeparator;
        if (strlen($separator) > 12 || preg_match('/[<>\x00-\x1f]/', $separator)) {
            throw new RuntimeException('Invalid separator for '.$cfg->label.' (maximum 12 characters)');
        }
        $separators[$id] = $separator;
    }
    if (!$enabled) throw new RuntimeException('At least one level must appear on the local label');
    return array('enabled'=>true, 'show'=>$enabled, 'separator'=>$separators,
        'show_warehouse'=>!empty($posted['show_warehouse']));
}

/** Testable label builder: omitted levels do not change the underlying location. */
function qrr_binloc_label_for_values($levels, $values, $settings, $warehouseCode = '') {
    if (!is_array($settings) || empty($settings['enabled']) || !is_array($values)) return '';
    $out = '';
    $visibleCount = 0;
    if (!empty($settings['show_warehouse'])) $out = (string)$warehouseCode;
    foreach ($levels as $id => $cfg) {
        $id = (string)(int)$id;
        if (empty($settings['show'][$id])) continue;
        $raw = $values[$id] ?? $values[(int)$id] ?? null;
        if ($raw === null || $raw === '') continue;
        $value = (string)$raw;
        if ($cfg->datatype === 'list' || $cfg->datatype === 'letter') {
            $match = null;
            foreach ($cfg->options as $opt) {
                if ((string)$opt->id === (string)$raw) { $match = $opt; break; }
            }
            // Do not silently show an option row ID in place of the configured label.
            if (!$match) return '';
            $value = (string)$match->value;
        }
        if ($out !== '') $out .= (string)($settings['separator'][$id] ?? '-');
        $out .= $value;
        $visibleCount++;
    }
    return $visibleCount ? $out : '';
}

/** Return a short label only when configured and resolvable; otherwise use full code. */
function qrr_binloc_local_label($db, $warehouseId, $item, $state = null) {
    static $cache = array();
    $full = (string)($item['bin'] ?? '');
    if (!$warehouseId || $full === '' || empty($item['bin_values'])) return $full;
    $settings = qrr_binloc_label_settings($warehouseId, $state);
    if (!$settings) return $full;
    try {
        $cacheKey = spl_object_id($db).':'.(int)$warehouseId;
        if (!isset($cache[$cacheKey])) {
            $cache[$cacheKey] = array('levels'=>qrr_binloc_levels($db, (int)$warehouseId), 'warehouses'=>null);
        }
        $levels = $cache[$cacheKey]['levels'];
        $warehouseCode = '';
        if (!empty($settings['show_warehouse'])) {
            if ($cache[$cacheKey]['warehouses'] === null) $cache[$cacheKey]['warehouses'] = qrr_warehouses($db);
            $warehouseCode = (string)($cache[$cacheKey]['warehouses'][(int)$warehouseId]['ref'] ?? '');
        }
        $label = qrr_binloc_label_for_values($levels, (array)$item['bin_values'], $settings, $warehouseCode);
        return $label !== '' ? $label : $full;
    } catch (Throwable $e) {
        // Never break existing item display if Binloc was removed or changed.
        return $full;
    }
}

/** Render the configured levels. Existing selected inactive options remain visible but must be actively reselected before saving a changed location. */
function qrr_binloc_levels_form($db, $warehouseId, $values = array(), $oldBin = '', $legacy = false) {
    if (!$warehouseId) return '<p class="qrr-small">Select a Dolibarr warehouse to load its Binloc levels.</p>';
    $levels = qrr_binloc_levels($db, $warehouseId);
    if (!$levels) return '<p class="qrr-alert">No Binloc levels are configured for this warehouse. Configure them under Binloc → Warehouse Levels.</p>';
    $html = '<div class="qrr-grid">';
    foreach ($levels as $id=>$cfg) {
        $val = isset($values[$id]) ? (string)$values[$id] : '';
        $html .= '<div><label for="qrr-level-'.(int)$id.'">'.qrr_h($cfg->label).'</label>';
        $attrs = ' name="qrr_levels['.(int)$id.']" id="qrr-level-'.(int)$id.'" class="qrr-input"';
        if ($cfg->datatype === 'list' || $cfg->datatype === 'letter') {
            $html .= '<select'.$attrs.'><option value="">Not assigned</option>';
            foreach ($cfg->options as $opt) {
                $isSelected = $val !== '' && (int)$val === (int)$opt->id;
                if (!(int)$opt->active && !$isSelected) continue;
                $name = (string)$opt->value.(!(int)$opt->active ? ' (inactive; existing)' : '');
                $html .= '<option value="'.(int)$opt->id.'"'.($isSelected?' selected':'').' title="'.qrr_h($opt->description).'">'.qrr_h($name).'</option>';
            }
            $html .= '</select>';
        } else {
            $html .= '<input type="'.($cfg->datatype==='number' ? 'number' : 'text').'"'.($cfg->datatype==='number' ? ' step="any"' : '').' maxlength="64"'.$attrs.' value="'.qrr_h($val).'" placeholder="'.qrr_h($cfg->label).'">';
        }
        $html .= '</div>';
    }
    $html .= '</div><p class="qrr-small">Select the full location here so positions remain unambiguous. A separate local-label setting can hide levels already marked on shelves or aisles without removing them from the saved location. Leave all levels blank for an unassigned location. <a href="'.qrr_h(qrr_link('binloc_labels.php',array('warehouse_id'=>$warehouseId))).'">Configure local labels</a>.</p>';
    if ($legacy && $oldBin !== '') {
        $html .= '<div class="qrr-alert"><label><input type="checkbox" name="qrr_keep_legacy" value="1" checked> Keep existing unmapped bin code <strong>'.qrr_h($oldBin).'</strong> if all levels are blank</label><p class="qrr-small">This QR was created before warehouse-level selection. Select the actual levels to convert it. When changing warehouse, the old bin code is never carried over.</p></div>';
    }
    return $html;
}
