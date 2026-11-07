<?php
/** Navigation is generated from one permission-filtered route catalog. */
error_reporting(E_ALL);
define('DOL_DOCUMENT_ROOT', sys_get_temp_dir().'/qrr-navigation-fixture');
function dol_buildpath($route, $type) { return '/custom'.(string)$route; }
require_once __DIR__.'/../lib/qrrouter.lib.php';

class NavTestUser {
    public $admin = 0;
    private $rights;
    public function __construct($rights, $admin = 0) { $this->rights = $rights; $this->admin = $admin; }
    public function hasRight(...$rights) { return in_array(implode('.', $rights), $this->rights, true); }
}
function navAssert($condition, $description) {
    if (!$condition) throw new RuntimeException('Navigation failure: '.$description);
}
$reader = new NavTestUser(array('qrrouter.read','produit.lire'));
$writer = new NavTestUser(array('qrrouter.read','qrrouter.manage','produit.lire','commande.lire'));
$admin = new NavTestUser(array(), 1);
navAssert(qrr_nav_active_id('/custom/qrrouter/workflow.php','move')==='move','active Move mode');
navAssert(qrr_nav_active_id('/custom/qrrouter/workflow.php','consume')==='consume','active Consume mode');
navAssert(qrr_nav_active_id('/custom/qrrouter/batches.php')==='batches','active batch page');
navAssert(qrr_nav_active_id('/custom/qrrouter/register_summary.php')==='register','active register summary');
navAssert(qrr_nav_active_id('/custom/qrrouter/other.php')==='','unknown URL does not highlight a link');
$readHtml=qrr_nav_html($reader, '/custom/qrrouter/index.php');
navAssert(strpos($readHtml,'aria-label="QR Product Router navigation"')!==false,'ARIA landmark');
navAssert(strpos($readHtml,'qrr-nav-mobile-menu')!==false,'mobile disclosure');
navAssert(strpos($readHtml,'qrr-nav-dropdown')!==false,'desktop disclosure');
navAssert(strpos($readHtml,'href="/custom/qrrouter/camera.php"')!==false,'reader can scan');
navAssert(strpos($readHtml,'href="/custom/qrrouter/batches.php"')!==false,'reader can browse batches');
navAssert(strpos($readHtml,'href="/custom/qrrouter/workflow.php?action=move"')===false,'reader cannot move');
navAssert(strpos($readHtml,'href="/custom/qrrouter/print_codes.php"')===false,'reader cannot print');
navAssert(strpos($readHtml,'href="/custom/qrrouter/pick.php"')===false,'reader cannot pick without order rights');
navAssert(strpos($readHtml,'href="/custom/qrrouter/people.php"')===false,'non-admin cannot edit people');
$writeHtml=qrr_nav_html($writer, '/custom/qrrouter/workflow.php', 'consume');
foreach (array('workflow.php?action=move','workflow.php?action=checkout','workflow.php?action=checkin','workflow.php?action=consume','register.php','batches.php','print_codes.php','binloc_labels.php','pick.php') as $path) {
    navAssert(strpos($writeHtml, 'href="/custom/qrrouter/'.$path.'"')!==false,'writer has '.$path);
}
navAssert(substr_count($writeHtml,'aria-current="page"')===2,'current section is identified in desktop and mobile navigation');
navAssert(strpos($writeHtml, 'qrr-nav-dropdown has-current')!==false,'current group highlighted');
navAssert(strpos(qrr_nav_html($admin, '/custom/qrrouter/people.php'),'people.php')!==false,'admin has tools');
$noProducts = new NavTestUser(array('qrrouter.read','qrrouter.manage'));
$noProductsHtml=qrr_nav_html($noProducts,'/custom/qrrouter/camera.php');
navAssert(strpos($noProductsHtml,'register.php')===false,'product permissions required for register');
navAssert(strpos($noProductsHtml,'print_codes.php')!==false,'printing does not require product read');
navAssert(strpos($noProductsHtml,'camera.php')!==false,'scanning remains available');
echo "Navigation links, active states, visibility and permissions PASSED.\n";
