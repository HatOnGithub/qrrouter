<?php
/** Integration-free handoff state/reconciliation tests with fake movement evidence. */
error_reporting(E_ALL);
define('DOL_DOCUMENT_ROOT', __DIR__);
define('MAIN_DB_PREFIX','llx_');
$tmp=sys_get_temp_dir().'/qrr-handoff-'.bin2hex(random_bytes(4));
@mkdir($tmp,0700,true);
define('DOL_DATA_ROOT',$tmp);
$conf=(object)array('entity'=>1);
require_once __DIR__.'/../lib/qrrouter.lib.php';
class QRTestDB {
    public $movementRows=array(); public $pos=0;
    public function escape($s){return addslashes($s);}
    public function query($sql){$this->pos=0;return true;}
    public function fetch_object($res){if($this->pos>=count($this->movementRows))return false;return (object)$this->movementRows[$this->pos++];}
}
$db=new QRTestDB();$user=(object)array('id'=>7,'admin'=>1);
$base=array('code'=>'ITM-123456','type'=>'tracked','product_id'=>51,'warehouse_id'=>1,'bin'=>'A01','bin_key'=>'1:o1','bin_values'=>array(1=>1),'qty'=>1,'serial'=>'DIOT001','details'=>'','label'=>'Test item');
qrr_update(function (&$s)use($base){$s['items'][$base['code']]=$base;},$user,'seed');
$pending=array('id'=>'QRR-ABC','inventorycode'=>'QRR-ABC','kind'=>'checkout','person_id'=>7,'from'=>1,'to'=>9,'qty'=>1,'product_id'=>51,'reason'=>'testing','at'=>gmdate('c',time()-90));
qrr_update(function (&$s)use($pending){$s['items']['ITM-123456']['pending_handoff']=$pending;},$user,'stage');
$db->movementRows=array(array('fk_entrepot'=>1,'value'=>-1,'fk_product'=>51),array('fk_entrepot'=>9,'value'=>1,'fk_product'=>51));
qrr_finish_handoff($db,$user,'ITM-123456',$pending);
$e=qrr_load_state()['items']['ITM-123456'];
assert($e['warehouse_id']===9 && $e['bin']==='' && $e['checkout']['origin_bin']==='A01' && !isset($e['pending_handoff']));
$back=array('id'=>'QRR-DEF','inventorycode'=>'QRR-DEF','kind'=>'checkin','person_id'=>7,'from'=>9,'to'=>1,'qty'=>1,'product_id'=>51,'reason'=>'','at'=>gmdate('c',time()-90));
qrr_update(function (&$s)use($back){$s['items']['ITM-123456']['pending_handoff']=$back;},$user,'stage');
$db->movementRows=array(array('fk_entrepot'=>9,'value'=>-1,'fk_product'=>51),array('fk_entrepot'=>1,'value'=>1,'fk_product'=>51));
qrr_finish_handoff($db,$user,'ITM-123456',$back);
$e=qrr_load_state()['items']['ITM-123456'];
assert($e['warehouse_id']===1 && $e['bin']==='A01' && $e['bin_key']==='1:o1' && !isset($e['checkout']));
qrr_update(function (&$s)use($pending){$s['items']['ITM-123456']['pending_handoff']=$pending;},$user,'stage');
$db->movementRows=array();
$result=qrr_reconcile_handoff($db,$user,'ITM-123456',$pending);
assert(strpos($result,'cancelled')!==false && !isset(qrr_load_state()['items']['ITM-123456']['pending_handoff']));
@unlink(qrr_state_file());@unlink(qrr_data_dir().'/state.lock');@rmdir(qrr_data_dir());@rmdir(dirname(qrr_data_dir()));@rmdir($tmp);
echo "Handoff staging, evidence, checkout, checkin, and empty-movement reconciliation passed.\n";
