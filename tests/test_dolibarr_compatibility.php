<?php
/** Execute selected, unmodified official native methods with isolated transport/DB doubles. */
$source = $argv[1];
$version = $argv[2];
$fixture = $argv[3];
define('DOL_DOCUMENT_ROOT', $fixture);
define('DOL_VERSION', $version);
error_reporting(E_ALL);
set_error_handler(function ($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
$checks = 0;
function check($condition, $message) {
    global $checks;
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $checks++;
}

/** Extract tokenized definitions, retaining the native method body and parameter defaults. */
function native_function($path, $name) {
    $tokens = token_get_all(file_get_contents($path));
    $count = count($tokens);
    for ($i = 0; $i < $count; $i++) {
        if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION) {
            continue;
        }
        $next = $i + 1;
        while ($next < $count && is_array($tokens[$next]) && $tokens[$next][0] === T_WHITESPACE) {
            $next++;
        }
        if (!is_array($tokens[$next]) || $tokens[$next][1] !== $name) {
            continue;
        }
        $text = '';
        $depth = 0;
        $opened = false;
        for ($j = $i; $j < $count; $j++) {
            $token = $tokens[$j];
            $text .= is_array($token) ? $token[1] : $token;
            if ($token === '{' || is_array($token) && in_array($token[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true)) {
                $depth++;
                $opened = true;
            } elseif ($token === '}' && --$depth === 0 && $opened) {
                return $text;
            }
        }
    }
    throw new RuntimeException('Missing native method ' . $name . ' in ' . $path);
}
function contract($file, $method, $parameters) {
    global $source;
    $definition = native_function($source . '/' . $file, $method);
    $signature = substr($definition, 0, strpos($definition, '{'));
    preg_match_all('/\$([A-Za-z_][A-Za-z0-9_]*)/', $signature, $matches);
    check(array_slice($matches[1], 0, count($parameters)) === $parameters, 'Changed parameter positions: ' . $method);
    // New mandatory arguments would break existing positional calls.
    $arguments = explode(',', substr($signature, strpos($signature, '(') + 1, strrpos($signature, ')') - strpos($signature, '(') - 1));
    foreach (array_slice($arguments, count($parameters)) as $argument) {
        check(str_contains($argument, '='), 'New mandatory argument: ' . $method);
    }
    return $definition;
}

$productFile = 'product/class/product.class.php';
$plain = contract($productFile, 'correct_stock', ['user', 'id_entrepot', 'nbpiece', 'movement', 'label', 'price', 'inventorycode']);
$batch = contract($productFile, 'correct_stock_batch', ['user', 'id_entrepot', 'nbpiece', 'movement', 'label', 'price', 'dlc', 'dluo', 'lot', 'inventorycode']);
contract($productFile, 'fetch', ['id']);
contract($productFile, 'load_stock', ['option']);
contract('product/stock/class/productlot.class.php', 'fetch', ['id', 'product_id', 'batch']);
contract('product/stock/class/productlot.class.php', 'create', ['user']);
$warehouseFetch = contract('product/stock/class/entrepot.class.php', 'fetch', ['id']);
contract('product/stock/class/entrepot.class.php', 'create', ['user']);
contract('user/class/user.class.php', 'hasRight', ['module', 'permlevel1', 'permlevel2']);
contract('core/lib/admin.lib.php', 'dolibarr_set_const', ['db', 'name', 'value', 'type', 'visible', 'note', 'entity']);
contract('core/modules/DolibarrModules.class.php', '_load_tables', ['reldir']);
contract('core/modules/DolibarrModules.class.php', '_init', ['array_sql', 'options']);
contract('core/modules/DolibarrModules.class.php', '_remove', ['array_sql', 'options']);
contract('core/class/extrafields.class.php', 'addExtraField', ['attrname', 'label', 'type', 'pos', 'size', 'elementtype', 'unique', 'required', 'default_value', 'param', 'alwayseditable', 'perms', 'list', 'help', 'computed', 'entity', 'langfile', 'enabled']);
contract('core/class/extrafields.class.php', 'fetch_name_optionals_label', ['elementtype']);
$restricted = contract('core/lib/security.lib.php', 'restrictedArea', ['user', 'features', 'object', 'tableandshare', 'feature2', 'dbt_keyfield', 'dbt_select', 'isdraft']);

class MovementDatabase {
    public $begins = 0;
    public $commits = 0;
    public $rollbacks = 0;
    public function begin() { $this->begins++; }
    public function commit() { $this->commits++; }
    public function rollback() { $this->rollbacks++; }
}
class MouvementStock {
    public static $calls = [];
    public static $result = 1;
    public $error = 'Native movement rejected';
    public $errors = [];
    public function __construct($db) {}
    public function setOrigin($element, $id) {}
    public function _create(...$arguments) {
        self::$calls[] = $arguments;
        return self::$result;
    }
}
class User {
    public $id = 8;
    public $admin = 0;
    public $socid = 0;
    public $status = 1;
}

// These are the official method bodies, not rewritten stock wrappers.
eval('class NativeProduct {
    public $id = 4;
    public $db;
    public $error = "";
    public $errors = [];
    public function setErrorsFromObject($object) { $this->error = $object->error; }
    public ' . $plain . "\npublic " . $batch . "\n}");
$movementFile = $fixture . '/product/stock/class/mouvementstock.class.php';
mkdir(dirname($movementFile), 0777, true);
file_put_contents($movementFile, '<?php /* MouvementStock is supplied by this isolated test. */');
$product = new NativeProduct();
$product->db = new MovementDatabase();
$user = new User();
foreach ([0, 1] as $direction) {
    check($product->correct_stock($user, 12, 3, $direction, 'QR transfer', 17.5, 'QRR-OP') === 1, 'Plain movement failed');
    $call = MouvementStock::$calls[array_key_last(MouvementStock::$calls)];
    check($call[1] === 4 && $call[2] === 12 && (float) $call[3] === ($direction ? -3.0 : 3.0), 'Changed stock sign or identity');
    check($call[5] === 17.5 && $call[7] === 'QRR-OP', 'Changed price or recovery marker');
    check($product->correct_stock_batch($user, 12, 2, $direction, 'QR batch', 17.5, 1700000000, 1800000000, 'BOX-001', 'QRR-BATCH') === 1, 'Batch movement failed');
    $call = MouvementStock::$calls[array_key_last(MouvementStock::$calls)];
    check((float) $call[3] === ($direction ? -2.0 : 2.0), 'Changed batch movement sign');
    check($call[7] === 'QRR-BATCH' && $call[9] === 1700000000 && $call[10] === 1800000000 && $call[11] === 'BOX-001', 'Changed batch/date/recovery positions');
}
check($product->db->commits === 4 && $product->db->rollbacks === 0, 'Successful movements did not commit');
MouvementStock::$result = -1;
check($product->correct_stock($user, 12, 1, 0) === -1, 'Native failure was ignored');
check($product->correct_stock_batch($user, 12, 1, 0) === -1, 'Native batch failure was ignored');
check($product->db->rollbacks === 2, 'Failed movements did not roll back');

// Use the real permission implementation to verify the adapter's 9/10-argument calls.
eval($restricted);
$hookmanager = new class {
    public $resArray = ['result' => 0];
    public $parameters = [];
    public function executeHooks($name, $parameters) {
        $this->parameters = $parameters;
        return $this->resArray['result'];
    }
};
function accessforbidden() { throw new RuntimeException('Permission check terminated instead of returning'); }
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter_security.lib.php';
check(!qrr_native_read_access($user, 'commande', 39, 'commande'), 'Denied native hook was bypassed');
$hookmanager->resArray = ['result' => 1];
check(qrr_native_read_access($user, 'commande', 39, 'commande'), 'Allowed native hook was ignored');
if ((new ReflectionFunction('restrictedArea'))->getNumberOfParameters() >= 10) {
    check($hookmanager->parameters['nodie'] === 1 && $hookmanager->parameters['mode'] === 'read', 'Explicit native read mode missing');
}
$user->status = 0;
check(!qrr_internal_user($user), 'Inactive modern-status user accepted');
$user->status = 1;
check(qrr_internal_user($user), 'Active modern-status user rejected');

// Instantiate our descriptor against this release's actual DolibarrModules base class.
$baseFile = $fixture . '/core/modules/DolibarrModules.class.php';
mkdir(dirname($baseFile), 0777, true);
copy($source . '/core/modules/DolibarrModules.class.php', $baseFile);
require_once __DIR__ . '/../dolibarr/qrrouter/core/modules/modQrrouter.class.php';
$module = new modQrrouter(null);
check($module->need_dolibarr_version === [21, 0, 2], 'Incorrect Dolibarr minimum');
check($module->phpmin === [8, 0], 'Incorrect PHP minimum');
check(empty($module->need_dolibarr_max_version), 'An upper version cap blocks incremental upgrades');

// Run the real warehouse fetch: older releases populate statut without updating status.
function dol_syslog($message, $level = 0) {}
function getCountry($id, $mode) { return ['label' => 'Fixture', 'code' => 'XX']; }
function qrr_stock_write_right($user) { return true; }
function qrr_product($db, $id) {
    return new class {
        public $type = 0;
        public function hasbatch() { return false; }
    };
}
class WarehouseDatabase {
    public $warehouseStatus = 1;
    public $exists = true;
    public function prefix() { return 'llx_'; }
    public function query($sql) { return true; }
    public function num_rows($result) { return $this->exists ? 1 : 0; }
    public function fetch_object($result) {
        return (object) (['statut' => $this->warehouseStatus] + array_fill_keys([
            'rowid', 'entity', 'fk_parent', 'fk_project', 'label', 'description', 'lieu',
            'address', 'zip', 'town', 'country_id', 'phone', 'fax', 'model_pdf', 'import_key',
            'date_creation', 'date_modification', 'fk_departement', 'barcode', 'fk_barcode_type',
            'warehouse_usage', 'user_creation_id',
        ], 1));
    }
}
eval('#[AllowDynamicProperties] class Entrepot {
    const STATUS_CLOSED = 0;
    public $db, $statut, $status, $error;
    public function __construct($db) { $this->db = $db; }
    public function fetch_optionals() {}
    public ' . $warehouseFetch . "\n}");
mkdir($fixture . '/core/lib', 0777, true);
file_put_contents($fixture . '/core/lib/company.lib.php', '<?php /* getCountry supplied above. */');
file_put_contents($fixture . '/product/stock/class/entrepot.class.php', '<?php /* Real fetch supplied above. */');
eval(native_function(__DIR__ . '/../dolibarr/qrrouter/lib/qrrouter_service.lib.php', 'qrr_warehouse_closed'));
eval(native_function(__DIR__ . '/../dolibarr/qrrouter/lib/qrrouter_service.lib.php', 'qrr_service_preflight'));
foreach ([
    [['statut' => 1, 'status' => 0], false],
    [['statut' => 0, 'status' => 1], true],
    [['status' => 1], false],
    [['status' => 0], true],
    [[], true],
] as [$properties, $closed]) {
    check(qrr_warehouse_closed((object) $properties) === $closed, 'Legacy, modern or unknown warehouse status mishandled');
}
$warehouseDb = new WarehouseDatabase();
foreach ([1, 2, 0] as $warehouseStatus) {
    $warehouseDb->warehouseStatus = $warehouseStatus;
    $warehouse = new Entrepot($warehouseDb);
    check($warehouse->fetch(12) === 1 && (int) $warehouse->statut === $warehouseStatus, 'Native warehouse status was not populated');
    $rejected = false;
    try {
        qrr_service_preflight($warehouseDb, $user, [], [
            'product_id' => 4,
            'effects' => [['warehouse_id' => 12, 'delta' => 1]],
        ]);
    } catch (RuntimeException $error) {
        check($error->getMessage() === 'Warehouse missing or closed', 'Unexpected warehouse preflight error');
        $rejected = true;
    }
    check($rejected === ($warehouseStatus === 0), 'Open warehouse rejected or closed warehouse accepted');
}
$warehouseDb->exists = false;
try {
    qrr_service_preflight($warehouseDb, $user, [], [
        'product_id' => 4,
        'effects' => [['warehouse_id' => 12, 'delta' => 1]],
    ]);
    throw new LogicException('Missing warehouse accepted');
} catch (RuntimeException $error) {
    check($error->getMessage() === 'Warehouse missing or closed', 'Unexpected missing warehouse error');
}
echo 'Dolibarr ' . $version . ': passed ' . $checks . ' native API/stock/permission/descriptor checks.' . PHP_EOL;
