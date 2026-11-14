<?php
/** Exercise independent grants using the real permission helpers. */
define('DOL_DOCUMENT_ROOT', __DIR__);
$disabled = [];
function isModEnabled($module) {
    return !in_array($module, $GLOBALS['disabled'], true);
}
require_once __DIR__ . '/../dolibarr/qrrouter/lib/qrrouter.lib.php';
class PermissionUser {
    public $id = 7,
        $socid = 0,
        $statut = 1,
        $admin = 0;
    public function __construct(public array $grants = []) {}
    public function hasRight(...$parts) {
        return in_array(implode('.', $parts), $this->grants, true);
    }
}
$checks = 0;
function check_permission($allowed, $message) {
    if (!$allowed) {
        throw new RuntimeException($message);
    }
    $GLOBALS['checks']++;
}
$base = ['qrrouter.use', 'qrrouter.read', 'produit.lire', 'stock.lire'];
check_permission(
    qrr_inventory_right(new PermissionUser($base)),
    'Module and native read grants allow inventory',
);
foreach ($base as $required) {
    check_permission(
        !qrr_inventory_right(new PermissionUser(array_values(array_diff($base, [$required])))),
        'Missing ' . $required . ' must deny module access',
    );
}
foreach (qrr_permission_keys() as $right) {
    $user = new PermissionUser([...$base, 'qrrouter.' . $right]);
    check_permission(qrr_permission_right($user, $right), 'Explicit grant permits ' . $right);
    foreach (qrr_permission_keys() as $other) {
        if ($other !== $right) {
            check_permission(
                !qrr_permission_right($user, $other),
                $right . ' must not imply ' . $other,
            );
        }
    }
}
$manager = new PermissionUser([...$base, 'qrrouter.manage']);
foreach (
    ['create', 'modify', 'delete', 'move', 'consume', 'return', 'adjust', 'loans', 'recover']
    as $right
) {
    check_permission(
        !qrr_permission_right($manager, $right),
        'Legacy manage does not override ' . $right,
    );
}
$stock = new PermissionUser([...$base, 'stock.mouvement.creer']);
check_permission(
    qrr_stock_write_right($stock),
    'Native stock capability is independent of module configuration',
);
check_permission(
    !qrr_permission_right($stock, 'move'),
    'Native stock permission alone cannot authorize a QR move',
);
$history = new PermissionUser([...$base, 'qrrouter.history']);
check_permission(!qrr_history_right($history), 'History requires native movement-read access');
$history->grants[] = 'stock.mouvement.lire';
check_permission(qrr_history_right($history), 'History grant and native read rights allow history');
$admin = new PermissionUser();
$admin->admin = 1;
check_permission(qrr_inventory_right($admin), 'Active internal administrators retain access');
$admin->socid = 10;
check_permission(!qrr_inventory_right($admin), 'External administrators cannot enter the module');
$admin->socid = 0;
$admin->statut = 0;
check_permission(!qrr_inventory_right($admin), 'Inactive administrators cannot enter the module');
$disabled = ['qrrouter'];
check_permission(
    !qrr_inventory_right(new PermissionUser($base)),
    'Disabled module cannot be bypassed by a grant',
);
echo 'Passed ' . $checks . " granular permission checks.\n";
