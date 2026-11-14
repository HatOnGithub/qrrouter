<?php
/** Standalone QR Router — Dolibarr 21 and newer. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}
require_once DOL_DOCUMENT_ROOT . '/core/modules/DolibarrModules.class.php';
class modQrrouter extends DolibarrModules {
    public function __construct($db) {
        $this->db = $db;
        $this->numero = 503871;
        $this->rights_class = 'qrrouter';
        $this->family = 'technic';
        $this->module_position = '91';
        $this->name = 'Qrrouter';
        $this->description =
            'QR item registration, scan-many warehouse workflows, native stock transfers, consumption, returns and internal location management.';
        $this->version = '0.3.11';
        $this->phpmin = [8, 0];
        $this->need_dolibarr_version = [21, 0, 2];
        $this->const_name = 'MAIN_MODULE_QRROUTER';
        $this->picto = 'barcode';
        $this->langfiles = ['qrrouter@qrrouter'];
        $this->dirs = [];
        $this->config_page_url = ['setup.php@qrrouter'];
        $this->depends = ['modProduct', 'modStock', 'modProductBatch'];
        $this->requiredby = [];
        $this->conflictwith = [];
        $this->module_parts = [
            'hooks' => [
                'data' => [
                    'productcard',
                    'warehousecard',
                    'productlotcard',
                    'product_lotlist',
                    'usercard',
                    'ordercard',
                    'mocard',
                    'expeditioncard',
                ],
            ],
        ];
        $this->const = [];
        $this->tabs = [];
        $qrRead =
            'isModEnabled("qrrouter") && isModEnabled("product") && isModEnabled("stock") && isModEnabled("productbatch") && $user->id > 0 && (int) ($user->status ?? $user->statut ?? 1) === 1 && empty($user->socid) && ($user->admin || ($user->hasRight("qrrouter", "use") && $user->hasRight("qrrouter", "read") && $user->hasRight("produit", "lire") && $user->hasRight("stock", "lire")))';
        foreach (
            ['product' => 'product', 'stock' => 'warehouse', 'productlot' => 'lot']
            as $native => $kind
        ) {
            $this->tabs[] = [
                'data' =>
                    $native .
                    ':+qrrouter:QRRRelatedEntries:qrrouter@qrrouter:' .
                    $qrRead .
                    ':/qrrouter/native.php?kind=' .
                    $kind .
                    '&id=__ID__',
            ];
        }
        $this->tabs[] = [
            'data' =>
                'stock:+qrrouterlocations:Locations:qrrouter@qrrouter:' .
                $qrRead .
                ':/qrrouter/index.php#/locations?warehouse_id=__ID__',
        ];
        // Numeric IDs persist in user/group grants. Keep identities stable when adding rights;
        // manage controls configuration and must never imply the independent action grants.
        $this->rights = [];
        $this->rights[] = [5038711, 'Read QR inventory and scan labels', 'r', 1, 'read'];
        $this->rights[] = [
            5038712,
            'Configure QR locations, label formats and module administration',
            'w',
            0,
            'manage',
        ];
        $this->rights[] = [5038713, 'View QR operation history', 'r', 0, 'history'];
        $this->rights[] = [5038714, 'Use QR Router', 'r', 0, 'use'];
        $this->rights[] = [
            5038715,
            'Create QR labels, items and physical bins; register labels',
            'w',
            0,
            'create',
        ];
        $this->rights[] = [
            5038716,
            'Modify QR metadata, locations and bin membership',
            'w',
            0,
            'modify',
        ];
        $this->rights[] = [5038717, 'Delete unused QR labels', 'd', 0, 'delete'];
        $this->rights[] = [5038718, 'Move QR inventory and physical bins', 'w', 0, 'move'];
        $this->rights[] = [5038719, 'Consume QR inventory', 'w', 0, 'consume'];
        $this->rights[] = [50387110, 'Return consumed QR inventory', 'w', 0, 'return'];
        $this->rights[] = [
            50387111,
            'Count, correct and transfer container quantities',
            'w',
            0,
            'adjust',
        ];
        $this->rights[] = [50387112, 'Check out and check in employee loans', 'w', 0, 'loans'];
        $this->rights[] = [50387113, 'Save and manually complete pick lists', 'w', 0, 'picking'];
        $this->rights[] = [50387114, 'Print QR labels and inventory reports', 'r', 0, 'print'];
        $this->rights[] = [
            50387115,
            'Reconcile and recover pending QR operations',
            'w',
            0,
            'recover',
        ];
        $this->menu = [
            [
                'fk_menu' => 0,
                'type' => 'top',
                'titre' => 'QR Router',
                'mainmenu' => 'qrrouter',
                'leftmenu' => 'qrrouter',
                'url' => '/qrrouter/index.php',
                'langs' => 'qrrouter@qrrouter',
                'position' => 120,
                'enabled' => '1',
                'perms' => $qrRead,
                'target' => '',
                'user' => 0,
            ],
        ];
        $this->menu[] = [
            'fk_menu' => 'fk_mainmenu=products,fk_leftmenu=stock',
            'type' => 'left',
            'titre' => 'QRRRelatedEntries',
            'mainmenu' => 'products',
            'leftmenu' => 'qrrouter_inventory',
            'url' => '/qrrouter/index.php#/inventory',
            'langs' => 'qrrouter@qrrouter',
            'position' => 150,
            'enabled' => 'isModEnabled("qrrouter")',
            'perms' => $qrRead,
            'target' => '',
            'user' => 0,
        ];
    }
    public function init($options = '') {
        if ($this->_load_tables('/qrrouter/sql/') < 0) {
            return -1;
        }
        require_once DOL_DOCUMENT_ROOT . '/core/class/extrafields.class.php';
        $extra = new ExtraFields($this->db);
        $extra->fetch_name_optionals_label('product');
        if (!empty($extra->error)) {
            $this->error = $extra->error;
            return -1;
        }
        if (!isset($extra->attributes['product']['label']['qrrouter_serial_prefix'])) {
            if (
                $extra->addExtraField(
                    'qrrouter_serial_prefix',
                    'QRRSerialPrefix',
                    'varchar',
                    100,
                    76,
                    'product',
                    0,
                    0,
                    '',
                    '',
                    0,
                    '',
                    '3',
                    'QRRSerialPrefixHelp',
                    '',
                    '',
                    'qrrouter@qrrouter',
                    'isModEnabled("qrrouter")',
                ) <= 0
            ) {
                $this->error = $extra->error;
                return -1;
            }
        }
        return $this->_init([], $options);
    }
    public function remove($options = '') {
        return $this->_remove([], $options);
    }
}
