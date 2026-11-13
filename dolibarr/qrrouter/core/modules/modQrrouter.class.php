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
        $this->version = '0.3.10';
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
            'isModEnabled("qrrouter") && isModEnabled("product") && isModEnabled("stock") && isModEnabled("productbatch") && $user->id > 0 && (int) ($user->status ?? $user->statut ?? 1) === 1 && empty($user->socid) && ($user->admin || (($user->hasRight("qrrouter", "read") || $user->hasRight("qrrouter", "manage")) && $user->hasRight("produit", "lire") && $user->hasRight("stock", "lire")))';
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
        $this->rights = [];
        $this->rights[] = [5038711, 'Read QR inventory and scan labels', 'r', 1, 'read'];
        $this->rights[] = [
            5038712,
            'Create QR labels and change QR inventory locations or quantities',
            'w',
            0,
            'manage',
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
                'perms' =>
                    '$user->admin || $user->rights->qrrouter->read || $user->rights->qrrouter->manage',
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
