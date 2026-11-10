<?php
define('DOL_DOCUMENT_ROOT', __DIR__);
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter.lib.php';
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter_labels.lib.php';
$checks = 0;
function label_check($condition, $description) {
    global $checks;
    if (!$condition) {
        throw new RuntimeException($description);
    }
    $checks++;
}
function dol_buildpath($path, $type = 0) {
    return '/custom' . $path;
}
$item = [
    'code' => '23456X',
    'type' => 'tracked',
    'serial' => 'SN-42',
    'label' => 'Named item',
    'native_batch' => 'LOT-FALLBACK',
];
$product = ['label' => 'Short product name', 'ref' => 'REF-42'];
$details = qrr_label_details($item, $product);
label_check(
    array_column($details, 'kind') === ['serial', 'name', 'ref'],
    'Serial, product name, reference priority',
);
label_check($details[1]['value'] === 'Named item', 'Individual labels use their own short name');
$generic = ['code' => '23456X', 'type' => 'generic', 'label' => ''];
label_check(
    qrr_label_details($generic, $product)[0]['value'] === 'Short product name',
    'Generic labels default to the product short name',
);
label_check(
    qrr_item_display_name($generic, $product) === 'Short product name',
    'Generic A4 names default to the product short name',
);
$generic['label'] = 'QR name override';
label_check(
    qrr_label_details($generic, $product)[0]['value'] === 'QR name override',
    'Generic labels allow a QR-specific name override',
);
label_check(
    qrr_item_display_name($generic, $product) === 'QR name override',
    'Generic A4 names use the override',
);
$item['serial'] = '';
label_check(
    qrr_label_details($item, $product)[0]['value'] === 'LOT-FALLBACK',
    'Native tracked serial fallback',
);
$item['type'] = 'box';
label_check(
    array_column(qrr_label_details($item, $product), 'kind') === ['name', 'ref'],
    'Box lots must not be mislabeled as serial numbers',
);
$item['type'] = 'unassigned';
$item['label'] = '';
$empty = qrr_label_details($item);
label_check($empty === [], 'Unassigned labels have no descriptive text');
foreach (qrr_label_profiles() as $profile) {
    label_check(
        qrr_label_details($item, $product, $profile['id'], 'MAIN') === [],
        'Unassigned labels omit all details at every size',
    );
}
$item['type'] = 'generic';
$onlyRef = qrr_label_details($item, ['ref' => 'REF-ONLY']);
label_check(
    $onlyRef[0]['value'] === 'REF-ONLY' && count($onlyRef) === 2,
    'Available values precede missing placeholders',
);
$item['serial'] = '<script>alert("x")</script>';
$html = qrr_dymo_label($item, $product);
label_check(
    !str_contains($html, '<script>') && str_contains($html, '&lt;script&gt;'),
    'Untrusted label values are escaped',
);
label_check(
    str_contains($html, 'class="qrr-id-code">23456X'),
    'QR lookup ID is always printed separately',
);
label_check(
    qrr_label_format('dymo-25x54') === 'dymo-25x54' && qrr_label_format('') === 'a4',
    'Explicit DYMO and compatible A4 profiles',
);
$rich = [
    'code' => '23456X',
    'type' => 'tracked',
    'serial' => 'SN-42',
    'native_batch' => 'SN-42',
    'label' => 'Motor unit',
    'bin' => 'A-3',
    'qty' => 0,
    'status' => 'in_stock',
    'details' => 'Service every twelve months',
];
$previous = 0;
foreach (qrr_label_profiles() as $profile) {
    $fields = qrr_label_details($rich, $product, $profile['id'], 'MAIN');
    label_check(count($fields) > $previous, 'Larger presets expose more available details');
    label_check(
        array_slice(array_column($fields, 'kind'), 0, 3) === ['serial', 'name', 'ref'],
        'Identification priority is stable at every size',
    );
    label_check(
        qrr_label_format($profile['id']) === $profile['id'],
        'Preset is allowed by format validation',
    );
    $previous = count($fields);
}
$full = qrr_label_details($rich, $product, 'dymo-54x101', 'MAIN');
label_check(
    in_array('details', array_column($full, 'kind'), true),
    'Largest label includes item details',
);
label_check(
    array_values(
        array_filter($full, function ($field) {
            return $field['kind'] === 'qty';
        }),
    )[0]['value'] === '0',
    'Zero quantity remains visible',
);
$rich['type'] = 'box';
$rich['serial'] = '';
$rich['native_batch'] = 'BOX-A';
label_check(
    in_array(
        'lot',
        array_column(qrr_label_details($rich, $product, 'dymo-32x57', 'MAIN'), 'kind'),
        true,
    ),
    'Medium box label includes native lot',
);
print 'Passed ' . $checks . " label checks.\n";
