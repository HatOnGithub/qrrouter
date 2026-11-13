<?php
/** Plain-text translation regressions; no Dolibarr instance or database required. */
define('DOL_DOCUMENT_ROOT', __DIR__);
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter.lib.php';

$checks = 0;
function same_translation($actual, $expected, $description) {
    global $checks;
    if ($actual !== $expected) {
        throw new RuntimeException($description . ': ' . var_export($actual, true));
    }
    $checks++;
}

same_translation(qrr_plain_translation('A &amp; B&hellip; &mdash; C'), 'A & B… — C', 'Named entities');
same_translation(qrr_plain_translation('&#38; &#8230; &#8212;'), '& … —', 'Decimal entities');
same_translation(qrr_plain_translation('&#x26; &#x2026; &#x2014;'), '& … —', 'Hex entities');
same_translation(qrr_plain_translation('&quot;A&quot; &apos;B&apos;'), '"A" \'B\'', 'Quotes');
same_translation(qrr_plain_translation('é è ë & … —'), 'é è ë & … —', 'Existing UTF-8');
same_translation(qrr_plain_translation('&notARealEntity; &amp;amp;'), '&notARealEntity; &', 'Repeated encoding');
same_translation(qrr_plain_translation('&amp;hellip; &amp;mdash; &amp;#8230;'), '… — …', 'Nested named and numeric references');
same_translation(qrr_plain_translation('&amp;amp;amp;amp;amp;'), '&amp;', 'Bound repeated decoding');

$langs = new class {
    public function trans($key) {
        throw new RuntimeException('HTML translation method must not be used when plain text is available');
    }

    public function transnoentitiesnoconv($key) {
        return 'A &amp; B&hellip; &mdash; C';
    }
};
same_translation(qrr_t('Example'), 'A & B… — C', 'Prefer Dolibarr plain-text translations');

$langs = new class {
    public function trans($key) {
        return 'A &amp; B&hellip; &mdash; C';
    }
};
same_translation(qrr_t('Example'), 'A & B… — C', 'Compatibility with HTML translation providers');

$langs = new class {
    public function trans($key) {
        return $key;
    }
};
same_translation(qrr_t('Fallback &amp; text&hellip; &mdash;'), 'Fallback & text… —', 'Missing key fallback');
same_translation(
    qrr_h(qrr_plain_translation('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    'Printable translations remain escaped'
);

require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter_print.lib.php';
$langs = (object) ['defaultlang' => 'nl_BE'];
same_translation(qrr_print_locale(), 'nl_NL', 'Print locale defaults to supported account language');
same_translation(qrr_print_locale('fr_FR'), 'fr_FR', 'Explicit print language');
same_translation(qrr_print_translations('nl_NL')['Warehouse inventory'], 'Magazijninventaris', 'Print-only report translation');
same_translation(qrr_print_translations('en_US')['Warehouse'], 'Warehouse', 'English explicitly overrides account language');
same_translation($langs->defaultlang, 'nl_BE', 'Print choice does not mutate account language');
try {
    qrr_print_locale('../en_US');
    throw new RuntimeException('Invalid print locale accepted');
} catch (InvalidArgumentException $error) { $checks++; }
echo 'Passed ' . $checks . " translation checks.\n";
