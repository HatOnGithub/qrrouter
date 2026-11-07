<?php
/** Standalone QR Router — Dolibarr 21.0.2. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}
require_once DOL_DOCUMENT_ROOT . '/core/modules/DolibarrModules.class.php';
class modQrrouter extends DolibarrModules {
    public function __construct($db) {
        $this->db = $db;
        $this->numero = 503871;
        $this->rights_class = 'qrrouter';
        $this->family = 'products';
        $this->module_position = '91';
        $this->name = 'Qrrouter';
        $this->description =
            'QR item registration, scan-many warehouse workflows, native stock transfers, consumption, returns and Binloc integration.';
        $this->version = '3.1.0';
        $this->const_name = 'MAIN_MODULE_QRROUTER';
        $this->picto = 'barcode';
        $this->langfiles = ['qrrouter@qrrouter'];
        $this->dirs = [];
        $this->config_page_url = ['setup.php@qrrouter'];
        $this->depends = ['modProduct', 'modStock', 'modBinloc'];
        $this->requiredby = [];
        $this->conflictwith = [];
        $this->module_parts = [];
        $this->const = [];
        $this->tabs = [];
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
                'user' => 2,
            ],
        ];
    }
    public function init($options = '') {
        return $this->_init([], $options);
    }
    public function remove($options = '') {
        return $this->_remove([], $options);
    }
}
