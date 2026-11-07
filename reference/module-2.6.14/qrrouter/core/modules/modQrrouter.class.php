<?php
/** Standalone QR Router — Dolibarr 21.0.2. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;
require_once DOL_DOCUMENT_ROOT.'/core/modules/DolibarrModules.class.php';
class modQrrouter extends DolibarrModules
{
    public function __construct($db)
    {
        $this->db = $db;
        $this->numero = 503871;
        $this->rights_class = 'qrrouter';
        $this->family = 'products';
        $this->module_position = '91';
        $this->name = 'Qrrouter';
        $this->description = 'QR item registration, scan-many warehouse workflows, native stock transfers, consumption, returns and Binloc integration.';
        $this->version = '2.6.14';
        $this->const_name = 'MAIN_MODULE_QRROUTER';
        $this->picto = 'barcode';
        $this->langfiles = array('qrrouter@qrrouter');
        $this->dirs = array();
        $this->config_page_url = array();
        $this->depends = array('modProduct', 'modStock', 'modBinloc');
        $this->requiredby = array();
        $this->conflictwith = array();
        $this->module_parts = array();
        $this->const = array();
        $this->tabs = array();
        $this->rights = array();
        $this->rights[] = array(5038711, 'Read QR inventory and scan labels', 'r', 1, 'read');
        $this->rights[] = array(5038712, 'Create QR labels and change QR inventory locations or quantities', 'w', 0, 'manage');
        $this->menu = array(
            array('fk_menu'=>0, 'type'=>'top', 'titre'=>'QR Product Router', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter', 'url'=>'/qrrouter/index.php', 'langs'=>'qrrouter@qrrouter', 'position'=>120, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->read', 'target'=>'', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_fd35edb7df56', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_camera', 'url'=>'/qrrouter/camera.php', 'langs'=>'qrrouter@qrrouter', 'position'=>95, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->read', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_cf3462134416', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_list', 'url'=>'/qrrouter/index.php', 'langs'=>'qrrouter@qrrouter', 'position'=>100, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->read', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_581e0cccf8af', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_batches', 'url'=>'/qrrouter/batches.php', 'langs'=>'qrrouter@qrrouter', 'position'=>100, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->read', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_179d4352e565', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_print', 'url'=>'/qrrouter/print_codes.php', 'langs'=>'qrrouter@qrrouter', 'position'=>101, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_50f0d39cb7b5', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_register', 'url'=>'/qrrouter/register.php', 'langs'=>'qrrouter@qrrouter', 'position'=>102, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_af5a527b41c9', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_move', 'url'=>'/qrrouter/workflow.php?action=move', 'langs'=>'qrrouter@qrrouter', 'position'=>103, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_db5509c0023b', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_checkout', 'url'=>'/qrrouter/workflow.php?action=checkout', 'langs'=>'qrrouter@qrrouter', 'position'=>104, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_262168361046', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_checkin', 'url'=>'/qrrouter/workflow.php?action=checkin', 'langs'=>'qrrouter@qrrouter', 'position'=>105, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_ba6d99d4757e', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_consume', 'url'=>'/qrrouter/workflow.php?action=consume', 'langs'=>'qrrouter@qrrouter', 'position'=>106, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_bea3457ddf49', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_return', 'url'=>'/qrrouter/return.php', 'langs'=>'qrrouter@qrrouter', 'position'=>107, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_fc153ec6d5bf', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_add', 'url'=>'/qrrouter/manage.php', 'langs'=>'qrrouter@qrrouter', 'position'=>110, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_3cc8ba40f339', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_bulk', 'url'=>'/qrrouter/bulk.php', 'langs'=>'qrrouter@qrrouter', 'position'=>112, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_6cccc3c0a46b', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_bins', 'url'=>'/qrrouter/bins.php', 'langs'=>'qrrouter@qrrouter', 'position'=>115, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->read', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_cdc6999fdcf1', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_binloc_labels', 'url'=>'/qrrouter/binloc_labels.php', 'langs'=>'qrrouter@qrrouter', 'position'=>116, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->manage', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_cf5e9e516db8', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_loans', 'url'=>'/qrrouter/loans.php', 'langs'=>'qrrouter@qrrouter', 'position'=>118, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->read', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_5102aa00c8d4', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_people', 'url'=>'/qrrouter/people.php', 'langs'=>'qrrouter@qrrouter', 'position'=>119, 'enabled'=>'1', 'perms'=>'$user->admin', 'user'=>2),
            array('fk_menu'=>'fk_mainmenu=qrrouter', 'type'=>'left', 'titre'=>'QRRUI_913a73fa3365', 'mainmenu'=>'qrrouter', 'leftmenu'=>'qrrouter_pick', 'url'=>'/qrrouter/pick.php', 'langs'=>'qrrouter@qrrouter', 'position'=>120, 'enabled'=>'1', 'perms'=>'$user->rights->qrrouter->read', 'user'=>2)
        );
    }
    public function init($options = '') { return $this->_init(array(), $options); }
    public function remove($options = '') { return $this->_remove(array(), $options); }
}
