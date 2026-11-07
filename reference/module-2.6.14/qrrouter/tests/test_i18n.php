<?php
/** Offline localisation regression suite. Never touches Dolibarr inventory. */
define('DOL_DOCUMENT_ROOT', __DIR__);
class QrrTestLangs {
    public $defaultlang;
    private $messages = array();
    function __construct($lang) { $this->defaultlang = $lang; }
    function load($domain) {
        $file = __DIR__.'/../langs/'.$this->defaultlang.'/qrrouter.lang';
        assert(is_file($file));
        foreach (file($file, FILE_IGNORE_NEW_LINES) as $line) {
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
            list($key, $value) = explode('=', $line, 2);
            $this->messages[$key] = $value;
        }
    }
    function trans($key) { return $this->messages[$key] ?? $key; }
}
$GLOBALS['langs'] = new QrrTestLangs('nl_NL');
require_once __DIR__.'/../lib/qrrouter.lib.php';
$types = qrr_types();
assert($types['tracked'] === 'Individueel gevolgd');
assert($types['generic'] === 'Generiek gevolgd');
assert($types['box'] === 'Container met aantal');
assert(qrr_js_translations()['Camera running'] === 'Camera actief');
assert(qrr_t('This key intentionally does not exist') === 'This key intentionally does not exist');
$source = '<section><button aria-label="Scan QR">Scan QR</button><input name="action" value="move" placeholder="Search products"><script>const text = "Scan QR";</script><p>Save and Finish</p></section>';
$result = qrr_translate_markup($source);
assert(str_contains($result, 'aria-label="QR scannen"'));
assert(str_contains($result, '>QR scannen</button>'));
assert(str_contains($result, 'name="action" value="move"'));
assert(str_contains($result, 'placeholder="Producten zoeken"'));
assert(str_contains($result, '<script>const text = "Scan QR";</script>'));
assert(str_contains($result, '>Opslaan en afronden</p>'));
// New language instance forces explicit reset of translator cache for a real locale switch.
// Production Dolibarr uses a single stable locale per HTTP request.
$GLOBALS['langs'] = new QrrTestLangs('fr_FR');
$GLOBALS['langs']->load('qrrouter@qrrouter');
assert(qrr_t('Tracked Generic') === 'Article générique suivi');
assert(qrr_js_translations()['Camera running'] === 'Caméra en marche');
assert(qrr_t('Counted Container') === 'Contenant compté');
assert(str_contains(qrr_translate_markup('<button>Save and Finish</button>'), 'Enregistrer et terminer'));
$GLOBALS['langs'] = new QrrTestLangs('en_US');
$GLOBALS['langs']->load('qrrouter@qrrouter');
assert(qrr_types()['tracked'] === 'Tracked Individual');
// The persisted machine type values are unchanged by translations.
$item = qrr_make_item('ITM-ABCDEF', 'box', 'Sample', 3, 1);
assert($item['type'] === 'box');
assert(qrr_qty($item) === null);
echo "QR Router en/NL/FR label, markup, script, form-value and type-identity tests passed.\n";
