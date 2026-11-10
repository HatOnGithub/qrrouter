<?php
/** Convert creation requests to trusted service fields and native batch identities. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_creation_text($data, $key) {
    $value = $data[$key] ?? '';
    if (!is_string($value)) {
        throw new InvalidArgumentException('Invalid ' . $key);
    }
    return trim(strip_tags($value));
}

function qrr_api_int($data, $key, $default = 0) {
    $value = $data[$key] ?? $default;
    if (filter_var($value, FILTER_VALIDATE_INT) === false) {
        throw new InvalidArgumentException('Invalid ' . $key);
    }
    return (int) $value;
}
function qrr_api_fields($data, $existing = null) {
    global $db, $user;
    $type = $data['type'] ?? 'generic';
    if (!is_string($type)) {
        throw new InvalidArgumentException('Invalid type');
    }
    $pid = qrr_api_int($data, 'product_id');
    $wid = qrr_api_int($data, 'warehouse_id');
    $qty =
        $type === 'box'
            ? (($data['qty'] ?? null) === null
                ? null
                : qrr_api_int($data, 'qty'))
            : ($type === 'unassigned'
                ? 0
                : 1);
    if (!qrr_locations_right($user) && (!empty($data['levels']) || !empty($data['keep_legacy']))) {
        throw new DomainException('Missing Binloc read permission');
    }
    $choice = qrr_binloc_choice(
        $db,
        $wid,
        $data['levels'] ?? [],
        $existing,
        !empty($data['keep_legacy']),
    );
    if (!qrr_locations_right($user) && $existing && $wid === (int) $existing['warehouse_id']) {
        $choice = array_intersect_key($existing, array_flip(['bin', 'bin_key', 'bin_values']));
    }
    $label = qrr_creation_text($data, 'label');
    $serial = qrr_creation_text($data, 'serial');
    if (strlen($label) > 140 || strlen($serial) > 100) {
        throw new InvalidArgumentException(
            'Label text exceeds the size limit: 140 UTF-8 bytes for item names, 100 for serial numbers and box names.',
        );
    }
    if ($type === 'tracked' && !empty($data['label_as_serial'])) {
        if ($label === '') {
            throw new InvalidArgumentException('Enter a label to use as the serial number.');
        }
        $serial = $label;
    }
    if ($type === 'tracked' && $serial === '') {
        if (!empty($existing['product_lot_id'])) {
            $serial = (string) $existing['serial'];
        } else {
            $serial = qrr_native_generate_serial($db, $pid, $label);
        }
    }
    $nativeBatch = $type === 'box' ? $label : ($type === 'tracked' ? $serial : '');
    if (
        in_array($type, ['box', 'tracked'], true) &&
        ($nativeBatch === '' || strlen($nativeBatch) > 100)
    ) {
        throw new InvalidArgumentException(
            'Enter a serial number or box name of at most 100 bytes',
        );
    }
    return qrr_service_fields(
        $type,
        $label,
        $pid,
        $wid,
        $choice,
        $qty,
        qrr_creation_text($data, 'details'),
        $serial,
        $nativeBatch,
    );
}
/** Prepare every native identity before staging so retries reuse the same serials. */
function qrr_api_bulk_fields($data) {
    global $db;
    $count = qrr_api_int($data, 'count');
    if ($count < 1 || $count > 200) {
        throw new InvalidArgumentException('Batch size must be between 1 and 200');
    }
    $type = $data['type'] ?? 'generic';
    if (!in_array($type, ['tracked', 'box'], true)) {
        return array_merge(qrr_api_fields($data), ['count' => $count]);
    }
    $hasLabels = array_key_exists('labels', $data);
    if ($hasLabels || $type === 'box' || !empty($data['label_as_serial'])) {
        $labels = $data['labels'] ?? null;
        if (!is_array($labels) || array_keys($labels) !== range(0, $count - 1)) {
            throw new InvalidArgumentException('Enter one label per individual item.');
        }
        foreach ($labels as $label) {
            if (!is_string($label) || trim(strip_tags($label)) === '') {
                throw new InvalidArgumentException('Enter one label per individual item.');
            }
        }
    } else {
        $labels = array_fill(0, $count, qrr_creation_text($data, 'label'));
    }
    $prefix = qrr_creation_text($data, 'serial');
    if (strlen($prefix) > 100) {
        throw new InvalidArgumentException('Serial prefixes must be at most 100 bytes');
    }
    $entries = [];
    $seen = [];
    foreach ($labels as $label) {
        $entry = $data;
        $entry['label'] = $label;
        $entry['label_as_serial'] = false;
        // Generate exactly one identity per entry; the mapper validates its length and native facts.
        $entry['serial'] =
            $type === 'tracked'
                ? (!empty($data['label_as_serial'])
                    ? trim(strip_tags($label))
                    : qrr_native_generate_serial(
                        $db,
                        qrr_api_int($data, 'product_id'),
                        $prefix !== '' ? $prefix : $label,
                    ))
                : '';
        $fields = qrr_api_fields($entry);
        $identity = $fields['native_batch'];
        $key = strtolower($identity);
        if (isset($seen[$key])) {
            throw new InvalidArgumentException(
                $type === 'box'
                    ? 'Each box name must be unique.'
                    : 'Each label must be unique when used as a serial number.',
            );
        }
        $seen[$key] = true;
        if (qrr_native_serial_exists($db, $fields['product_id'], $identity)) {
            throw new InvalidArgumentException(
                ($type === 'box'
                    ? 'A box lot in this batch already exists in Dolibarr: '
                    : 'A serial number in this batch already exists in Dolibarr: ') . $identity,
            );
        }
        $entries[] = $fields;
    }
    return array_merge($entries[0], ['count' => $count, 'entries' => $entries]);
}
