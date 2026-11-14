<?php
/** Rendering symbology is independent of the existing short ID/checksum and domain state. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}

function qrr_barcode_formats($compact = false) {
    static $formats = null;
    $formats ??= json_decode(
        file_get_contents(__DIR__ . '/../assets/barcode-formats.json'),
        true,
        16,
        JSON_THROW_ON_ERROR,
    );
    return array_values(
        array_filter(
            $formats,
            fn($format) => !$compact || in_array($format['id'], ['QRCODE', 'DATAMATRIX'], true),
        ),
    );
}

/** Only formats that can represent the unchanged alphanumeric IDs are supported. */
function qrr_barcode_format($value, $compact = false) {
    $id = (string) $value;
    if ($id === '') {
        $id = 'QRCODE';
    }
    foreach (qrr_barcode_formats($compact) as $format) {
        if ($format['id'] === $id) {
            return $format;
        }
    }
    throw new InvalidArgumentException('Unsupported barcode format');
}

/**
 * Reuse Dolibarr's Barcode engine mapping and bundled TCPDF renderers. This rendering utility
 * works without enabling native product-barcode editing; no barcode record is modified.
 * New images use SVG for sharp printing without GD; legacy QR image requests retain PNG.
 */
function qrr_barcode_image($payload, $symbology, $png = false) {
    qrr_barcode_format($symbology);
    $enginePath = DOL_DOCUMENT_ROOT . '/core/modules/barcode/doc/tcpdfbarcode.modules.php';
    if (!is_file($enginePath)) {
        throw new RuntimeException('Dolibarr barcode engine is unavailable');
    }
    require_once $enginePath;
    $engine = new modTcpdfbarcode();
    $encoding = $engine->getTcpdfEncodingType($symbology === 'QRCODE' ? 'QRCODE,H' : $symbology);
    if (!$encoding) {
        throw new InvalidArgumentException('Unsupported barcode format');
    }
    $file = $engine->is2d ? 'tcpdf_barcodes_2d.php' : 'tcpdf_barcodes_1d.php';
    $paths = [
        DOL_DOCUMENT_ROOT . '/includes/tecnickcom/tcpdf/' . $file,
        DOL_DOCUMENT_ROOT . '/includes/tcpdf/' . $file,
    ];
    if (defined('TCPDF_PATH')) {
        array_unshift($paths, TCPDF_PATH . $file);
    }
    $path = current(array_filter($paths, 'is_file'));
    if (!$path) {
        throw new RuntimeException('Dolibarr barcode renderer is unavailable');
    }
    require_once $path;
    $barcode = $engine->is2d
        ? new TCPDF2DBarcode($payload, $encoding)
        : new TCPDFBarcode($payload, $encoding);
    if (!$barcode->getBarcodeArray()) {
        throw new InvalidArgumentException('Identifier is not valid for this barcode format');
    }
    $image = $png
        ? $barcode->getBarcodePngData($engine->is2d ? 5 : 2, $engine->is2d ? 5 : 60, [0, 0, 0])
        : $barcode->getBarcodeSVGcode($engine->is2d ? 5 : 2, $engine->is2d ? 5 : 60, 'black');
    if (!$image) {
        throw new RuntimeException('Barcode image could not be generated');
    }
    return $image;
}

/** Long location/bin route payloads use compact square formats rather than narrow linear labels. */
function qrr_barcode_selector($symbology, $values, $compact = false) {
    print '<form method="get" class="qrr-noprint"><label>' .
        qrr_h(qrr_t('Barcode format')) .
        ' <select name="symbology">';
    foreach (qrr_barcode_formats($compact) as $format) {
        print '<option value="' .
            qrr_h($format['id']) .
            '"' .
            ($format['id'] === $symbology ? ' selected' : '') .
            '>' .
            qrr_h($format['label']) .
            '</option>';
    }
    print '</select></label>';
    foreach ($values as $key => $value) {
        print '<input type="hidden" name="' . qrr_h($key) . '" value="' . qrr_h($value) . '">';
    }
    print ' <button type="submit">' . qrr_h(qrr_t('Apply settings')) . '</button></form>';
}
