<?php
/** Workflow engine for QR Router 2.6.0. No Dolibarr core or Binloc writes. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

function qrr_item_status($item) {
    if (($item['type'] ?? '') === 'unassigned') return 'unassigned';
    return ($item['status'] ?? 'in_stock') === 'consumed' ? 'consumed' : 'in_stock';
}
function qrr_available($item) {
    return qrr_item_status($item) === 'in_stock' && empty($item['checkout']) && empty($item['pending_handoff']) && empty($item['pending_operation']);
}
function qrr_workflow_codes($raw, $limit = 200) {
    if (is_array($raw)) $raw = implode("\n", $raw);
    if (!is_string($raw) || strlen($raw) > $limit * 65) throw new RuntimeException('Too many scanned codes');
    $codes = preg_split('/[\s,;]+/', strtoupper(trim($raw)), -1, PREG_SPLIT_NO_EMPTY);
    if (count($codes) > $limit) throw new RuntimeException('Maximum '.(int)$limit.' codes per operation');
    $unique = array();
    foreach ($codes as $code) {
        if (!qrr_code_valid($code)) throw new RuntimeException('Invalid QR identifier: '.substr($code, 0, 52));
        $unique[$code] = $code;
    }
    return array_values($unique);
}
function qrr_registration_fields($db, $user, $posted, $warehouses, $type) {
    if (!in_array($type, array('tracked', 'generic', 'box'), true)) throw new RuntimeException('Invalid registration type');
    $label = trim(strip_tags((string)($posted['label'] ?? '')));
    $pid = (int)($posted['product_id'] ?? 0);
    $wid = (int)($posted['warehouse_id'] ?? 0);
    $text = trim((string)($posted['qty'] ?? ''));
    if ($type === 'box' && !preg_match('/^(?:0|[1-9][0-9]{0,8})$/D', $text)) throw new RuntimeException('Enter a known quantity for this container');
    $qty = $type === 'box' ? (int)$text : 1;
    $serial = $type === 'tracked' ? trim(strip_tags((string)($posted['serial'] ?? ''))) : '';
    $details = $type === 'tracked' ? trim(strip_tags((string)($posted['details'] ?? ''))) : '';
    $nativeBatch = $type === 'tracked' ? trim(strip_tags((string)($posted['native_batch'] ?? ''))) : '';
    if (strlen($nativeBatch) > 100) throw new RuntimeException('Native batch value is too long');
    $choice = qrr_binloc_choice($db, $wid, $posted['qrr_levels'] ?? array());
    qrr_item_validate($type, $label, $pid, $wid, $choice['bin'], $qty, $details, $serial, $db, $warehouses, $user);
    if (!$wid || !$pid) throw new RuntimeException('Choose a product and Dolibarr warehouse to register stock-tracked items');
    $product = qrr_product($db, $pid);
    if (!$product || (int)$product->type !== 0) throw new RuntimeException('Select a physical Dolibarr product. Services cannot be registered as warehouse stock.');
    return array('label'=>$label, 'product_id'=>$pid, 'warehouse_id'=>$wid, 'choice'=>$choice, 'qty'=>$qty, 'serial'=>$serial, 'details'=>$details, 'native_batch'=>$nativeBatch);
}
/** Metadata registration only: native quantities are not increased on registration. */
function qrr_register_codes($db, $user, $codes, $type, $fields) {
    if (!qrr_write_right($user)) throw new RuntimeException('QR management permission required');
    if (!$codes || count($codes) > 200) throw new RuntimeException('Scan between 1 and 200 QR labels');
    if ($type === 'tracked' && count($codes) !== 1) throw new RuntimeException('Serialised unique registration accepts one label at a time');
    if ($type === 'box' && count($codes) !== 1) throw new RuntimeException('Quantity-based container registration accepts one label at a time');
    return qrr_update(function (&$s) use ($codes, $type, $fields) {
        foreach ($codes as $code) {
            if (!isset($s['items'][$code]) || ($s['items'][$code]['type'] ?? '') !== 'unassigned') throw new RuntimeException('QR label is not unassigned: '.$code);
        }
        $created = array();
        foreach ($codes as $code) {
            $old=$s['items'][$code];
            $record=qrr_make_item($code,$type,$fields['label'],$fields['product_id'],$fields['warehouse_id'],$fields['choice'],$fields['qty'],$fields['details'],$fields['serial'],$fields['native_batch']);
            $record['created_at']=$old['created_at'] ?? gmdate('c');
            $record['registered_at']=gmdate('c');
            $record['status']='in_stock';
            $record['consumed_units']=0;
            $s['items'][$code]=$record;
            $created[]=$code;
        }
        return $created;
    },$user,'register_items',array('codes'=>$codes,'type'=>$type,'product_id'=>$fields['product_id'],'warehouse_id'=>$fields['warehouse_id'],'native_stock_changed'=>false));
}
/** Read-only observation used by stock engine. */
function qrr_native_evidence($db, $op) {
    $sql="SELECT fk_entrepot, value, fk_product FROM ".MAIN_DB_PREFIX."stock_mouvement WHERE inventorycode='".$db->escape($op['id'])."'";
    $res=$db->query($sql);
    if (!$res) throw new RuntimeException('Cannot verify native stock movements: '.$db->lasterror());
    $expected=$op['effects']; $seen=array_fill(0,count($expected),0); $other=0;
    while ($m=$db->fetch_object($res)) {
        $matched=false;
        foreach ($expected as $i=>$effect) {
            if ((int)$m->fk_product === (int)$op['product_id'] && (int)$m->fk_entrepot === (int)$effect['warehouse_id'] && abs((float)$m->value - (float)$effect['delta']) < 0.00001) {
                $seen[$i]++; $matched=true; break;
            }
        }
        if (!$matched) $other++;
    }
    $db->free($res);
    return array('seen'=>$seen,'other'=>$other);
}
function qrr_native_evidence_complete($proof) {
    if ($proof['other'] !== 0) return false;
    foreach ($proof['seen'] as $count) if ($count !== 1) return false;
    return true;
}
function qrr_native_evidence_none($proof) {
    if ($proof['other'] !== 0) return false;
    foreach ($proof['seen'] as $count) if ($count !== 0) return false;
    return true;
}
/** Stock adjustments are committed through Dolibarr's own Product API. */
function qrr_native_apply($db, $user, $entry, $op) {
    if (!qrr_native_evidence_none(qrr_native_evidence($db,$op))) throw new RuntimeException('Movement with this inventory code already exists. Reconcile before retrying.');
    $product=qrr_product($db,(int)$op['product_id']);
    if (!$product || (int)$product->type !== 0) throw new RuntimeException('Native stock changes require a physical Dolibarr product');
    require_once DOL_DOCUMENT_ROOT.'/product/stock/class/entrepot.class.php';
    foreach ($op['effects'] as $effect) {
        $w=new Entrepot($db);
        if ($w->fetch((int)$effect['warehouse_id'])<=0 || (int)$w->status===(int)Entrepot::STATUS_CLOSED) throw new RuntimeException('Warehouse unavailable or closed');
        if ((float)$effect['delta'] < 0 && qrr_stock_qty($db,(int)$op['product_id'],(int)$effect['warehouse_id']) + 0.00001 < -(float)$effect['delta']) throw new RuntimeException('Insufficient stock in source warehouse');
    }
    if ($db->begin() <= 0) throw new RuntimeException('Cannot begin native stock transaction');
    try {
        $product->load_stock('novirtual');
        $price=isset($product->pmp)?(float)$product->pmp:0.0;
        foreach ($op['effects'] as $effect) {
            $wh=(int)$effect['warehouse_id'];$signed=(int)$effect['delta'];$n=abs($signed);
            if ($n===0) continue;
            $label='QR '.substr($op['kind'],0,35).' '.$entry['code'].' '.substr((string)($op['reason']??''),0,100);
            if ($product->hasbatch()) {
                $batch=(string)($entry['native_batch']??'');
                if ($batch==='') throw new RuntimeException('Native batch/serial missing. Use a native Dolibarr adjustment first.');
                if ($signed<0) list($batch,$eatby,$sellby)=qrr_native_batch($db,$product,$entry,$wh,$n);
                else { $eatby=0;$sellby=0; }
                $result=$product->correct_stock_batch($user,$wh,$n,$signed<0?1:0,$label,$price,$eatby,$sellby,$batch,$op['id']);
            } else {
                $result=$product->correct_stock($user,$wh,$n,$signed<0?1:0,$label,$price,$op['id']);
            }
            if ($result < 0) throw new RuntimeException('Native stock change failed: '.($product->error ?: implode('; ',(array)$product->errors)));
        }
        if ($db->commit()<=0) throw new RuntimeException('Commit status unknown; reconcile pending QR operation before retrying');
    } catch (Throwable $e) { $db->rollback(); throw $e; }
}
function qrr_op_delta($op) { $sum=0;foreach($op['effects'] as $effect)$sum+=(int)$effect['delta'];return $sum; }
/** Plans the only allowed persisted changes, never accepting arbitrary field replacement from POST. */
function qrr_plan_inventory_action($entry, $kind, $arg, $warehouses) {
    if (($entry['type'] ?? '')==='unassigned') throw new RuntimeException('Assign this QR label before an inventory operation');
    if (!qrr_available($entry)) throw new RuntimeException('This item is checked out, consumed, or has a pending operation');
    $from=(int)($entry['warehouse_id']??0);
    $qty=$entry['type']==='box'?($entry['qty']??null):1;
    $pid=(int)($entry['product_id']??0);
    $reason=trim(strip_tags((string)($arg['reason']??'')));
    if(strlen($reason)>200)throw new RuntimeException('Reason is too long');
    $effects=array();$patch=array();
    if($kind==='move'){
        $to=(int)($arg['warehouse_id']??0);
        if(!$to || !isset($warehouses[$to]))throw new RuntimeException('Choose a valid destination warehouse');
        $choice=$arg['choice']??array('bin'=>'','bin_key'=>'','bin_values'=>array());
        if($from!==$to && $qty===0 && $entry['type']==='box') {
            // Moving an empty labelled container does not move Dolibarr product stock.
        }elseif($from!==$to){
            if(!$from || !$pid || !is_int($qty) || $qty<1)throw new RuntimeException('Warehouse transfers require a product and known positive quantity');
            $effects=array(array('warehouse_id'=>$from,'delta'=>-$qty),array('warehouse_id'=>$to,'delta'=>$qty));
        }
        $patch=array('warehouse_id'=>$to,'bin'=>$choice['bin'],'bin_key'=>$choice['bin_key'],'bin_values'=>$choice['bin_values']);
    }elseif($kind==='consume'){
        if (!$pid||!$from)throw new RuntimeException('Consumption requires a linked product and warehouse');
        if(!is_int($qty)||$qty<1)throw new RuntimeException('Cannot consume a zero/unknown quantity');
        $count=(int)($arg['quantity']??0);
        if($count<1||$count>$qty || ($entry['type']!=='box' && $count!==1))throw new RuntimeException('Invalid consumption quantity');
        $newQty=$qty-$count;
        $patch=array('status'=>$newQty===0?'consumed':'in_stock','consumed_units'=>(int)($entry['consumed_units']??0)+$count);
        if($entry['type']==='box')$patch['qty']=$newQty;
        if($newQty===0)$patch['consumed_at']=gmdate('c');
        if(!empty($arg['post_stock']))$effects[]=array('warehouse_id'=>$from,'delta'=>-$count);
    }elseif($kind==='correct'){
        if($entry['type']!=='box')throw new RuntimeException('Only quantity-based containers have count corrections');
        if($qty===null)throw new RuntimeException('Unknown box count: establish QR count separately before a stock delta');
        $count=(int)($arg['quantity']??-1);
        if($count<0||$count>100000000)throw new RuntimeException('Invalid corrected quantity');
        $delta=$count-$qty;
        if($delta!==0){if(!$pid||!$from)throw new RuntimeException('Stock correction needs a product and warehouse');$effects[]=array('warehouse_id'=>$from,'delta'=>$delta);}
        $patch=array('qty'=>$count);
    }else throw new RuntimeException('Unknown inventory action');
    return array('kind'=>$kind,'product_id'=>$pid,'effects'=>$effects,'patch'=>$patch,'reason'=>$reason,
      'reference_type'=>(string)($arg['reference_type']??''),'reference_id'=>(int)($arg['reference_id']??0),'amount'=>(int)($arg['quantity']??0));
}
function qrr_plan_return_action($entry,$arg) {
    if (($entry['type']??'')==='unassigned'||!empty($entry['checkout'])||!empty($entry['pending_handoff'])||!empty($entry['pending_operation']))throw new RuntimeException('Item is unavailable for return');
    $outstanding=(int)($entry['consumed_units']??0);
    if(qrr_item_status($entry)!=='consumed' && $outstanding<1)throw new RuntimeException('This item has no recorded consumption to return');
    $qty=(int)($arg['quantity']??0);
    if($qty<1 || ($outstanding && $qty>$outstanding) || ($entry['type']!=='box' && $qty!==1))throw new RuntimeException('Invalid quantity to return');
    if(($entry['type']??'')==='box' && (int)($entry['qty']??0)+$qty>100000000)throw new RuntimeException('Container capacity exceeded');
    if(!isset($arg['warehouse_id']) || (int)$arg['warehouse_id']<1)throw new RuntimeException('Choose a return warehouse');
    $to=(int)$arg['warehouse_id'];$pid=(int)($entry['product_id']??0);
    if(($entry['type']??'')==='box' && (int)($entry['qty']??0)>0 && (int)($entry['warehouse_id']??0)!==$to)throw new RuntimeException('A partly consumed container must be returned to its current warehouse; move the whole container separately.');
    if(!$pid)throw new RuntimeException('Return requires a linked product');
    $reason=trim(strip_tags((string)($arg['reason']??'')));
    if(strlen($reason)>200)throw new RuntimeException('Reason too long');
    $patch=array('status'=>'in_stock','warehouse_id'=>$to,'bin'=>$arg['choice']['bin'],'bin_key'=>$arg['choice']['bin_key'],'bin_values'=>$arg['choice']['bin_values'],'consumed_units'=>max(0,$outstanding-$qty));
    if($entry['type']==='box')$patch['qty']=(int)($entry['qty']??0)+$qty;
    $effects= !empty($arg['post_stock'])?array(array('warehouse_id'=>$to,'delta'=>$qty)):array();
    return array('kind'=>'return','product_id'=>$pid,'effects'=>$effects,'patch'=>$patch,'reason'=>$reason,'reference_type'=>'','reference_id'=>0,'amount'=>$qty);
}
function qrr_apply_inventory_patch(&$s,$code,$op) {
    $item=&$s['items'][$code];
    foreach($op['patch'] as $k=>$v)$item[$k]=$v;
    $item['updated_at']=gmdate('c');
    if($op['kind']==='consume'||$op['kind']==='return') {
        if(!isset($item['consumption_log'])||!is_array($item['consumption_log']))$item['consumption_log']=array();
        $item['consumption_log'][]=array('at'=>gmdate('c'),'kind'=>$op['kind'],'quantity'=>$op['amount'],'reason'=>$op['reason'],'reference_type'=>$op['reference_type'],'reference_id'=>$op['reference_id'],'stock_posted'=>count($op['effects'])>0,'inventorycode'=>$op['id']??'');
    }
}
/** Durable staging and evidence-based completion allows reconciliation after a PHP interruption. */
function qrr_run_inventory_action($db,$user,$code,$kind,$args,$warehouses) {
    if(!qrr_write_right($user))throw new RuntimeException('QR management permission required');
    if(!qrr_code_valid($code))throw new RuntimeException('Invalid QR code');
    $op=qrr_update(function (&$s)use($db,$code,$kind,$args,$warehouses,$user){
        if(!isset($s['items'][$code]))throw new RuntimeException('Unknown QR identifier '.$code);
        $entry=$s['items'][$code];
        $op=$kind==='return'?qrr_plan_return_action($entry,$args):qrr_plan_inventory_action($entry,$kind,$args,$warehouses);
        if(isset($op['patch']['warehouse_id']) && !isset($warehouses[(int)$op['patch']['warehouse_id']]))throw new RuntimeException('Destination warehouse no longer accessible');
        if($op['effects']){
            if(!qrr_stock_write_right($user))throw new RuntimeException('Dolibarr Stock movement permission required');
            $p=qrr_product($db,$op['product_id']);
            if(!$p||(int)$p->type!==0)throw new RuntimeException('Use a physical stock-managed Dolibarr product');
            if($p->hasbatch() && empty($entry['native_batch']))throw new RuntimeException('This Dolibarr product uses native lot/serial tracking. Set the actual native batch on the tracked QR item or use a native Dolibarr adjustment.');
            require_once DOL_DOCUMENT_ROOT.'/product/stock/class/entrepot.class.php';
            foreach($op['effects'] as $effect) {
                $wid=(int)$effect['warehouse_id'];
                if(!isset($warehouses[$wid]))throw new RuntimeException('Warehouse no longer accessible');
                $warehouse=new Entrepot($db);
                if($warehouse->fetch($wid)<=0 || (int)$warehouse->status===(int)Entrepot::STATUS_CLOSED)
                    throw new RuntimeException('Warehouse is missing or closed; no stock operation was staged');
                if($effect['delta']<0){
                    if(qrr_stock_qty($db,$op['product_id'],$wid)+0.00001<-$effect['delta'])throw new RuntimeException('Insufficient native stock in source warehouse');
                    // Catch a missing/insufficient serialised lot before writing pending_operation.
                    if($p->hasbatch())qrr_native_batch($db,$p,$entry,$wid,-(int)$effect['delta']);
                }
            }
            $op['id']='QRR-'.strtoupper(bin2hex(random_bytes(10)));
            $op['at']=gmdate('c');
            $s['items'][$code]['pending_operation']=$op;
        }else{
            $op['id']=''; qrr_apply_inventory_patch($s,$code,$op);
        }
        return $op;
    },$user,$kind.'_stage',array('code'=>$code,'kind'=>$kind));
    if(!$op['effects'])return $op;
    try {
        $entry=qrr_load_state()['items'][$code];
        qrr_native_apply($db,$user,$entry,$op);
    } catch(Throwable $e) {
        throw new RuntimeException($e->getMessage().' Pending operation '.$op['id'].' is retained. Reconcile it before retrying.');
    }
    qrr_finish_inventory_action($db,$user,$code,$op);
    return $op;
}
function qrr_finish_inventory_action($db,$user,$code,$op) {
    $proof=qrr_native_evidence($db,$op);
    if(!qrr_native_evidence_complete($proof))throw new RuntimeException('Incomplete native stock evidence. Reconcile before continuing.');
    qrr_update(function (&$s)use($code,$op){
        if(!isset($s['items'][$code]) || ($s['items'][$code]['pending_operation']['id']??'')!==$op['id'])throw new RuntimeException('Pending operation changed');
        qrr_apply_inventory_patch($s,$code,$op);
        unset($s['items'][$code]['pending_operation']);
    },$user,$op['kind'].'_complete',array('code'=>$code,'inventorycode'=>$op['id'],'effects'=>$op['effects'],'reason'=>$op['reason']));
}
function qrr_reconcile_inventory_action($db,$user,$code) {
    if(!qrr_stock_write_right($user))throw new RuntimeException('Native stock permission required');
    $state=qrr_load_state();$op=$state['items'][$code]['pending_operation']??null;
    if(!$op)throw new RuntimeException('No pending operation');
    if(time()-(strtotime($op['at']??'')?:time())<30)throw new RuntimeException('Operation may still be running. Try after the request finishes.');
    $proof=qrr_native_evidence($db,$op);
    if(qrr_native_evidence_complete($proof)){qrr_finish_inventory_action($db,$user,$code,$op);return 'Completed from native stock evidence';}
    if(!qrr_native_evidence_none($proof))throw new RuntimeException('Partial/conflicting movements: manual reconciliation required');
    qrr_update(function (&$s)use($code,$op){
        if(($s['items'][$code]['pending_operation']['id']??'')!==$op['id'])throw new RuntimeException('Pending operation changed');
        unset($s['items'][$code]['pending_operation']);
    },$user,'operation_cancel_no_stock',array('code'=>$code,'inventorycode'=>$op['id']));
    return 'Cancelled pending operation: no native stock movements found';
}
/** Only supported Dolibarr reference tables may be queried. */
function qrr_reference_schema($type) {
    $map=array('shipment'=>'expedition','production'=>'mrp_mo','salesorder'=>'commande');
    if(!isset($map[$type]))throw new RuntimeException('Invalid transaction type');
    return $map[$type];
}
function qrr_check_reference($db,$user,$type,$id) {
    $table=qrr_reference_schema($type);
    if($id<1)throw new RuntimeException('Select an exact shipment or order');
    if($type==='salesorder'&&!qrr_orders_right($user))throw new RuntimeException('Missing sales order permission');
    if($type==='shipment'&&empty($user->admin)&&!$user->hasRight('expedition','lire'))throw new RuntimeException('Missing shipment permission');
    if($type==='production'&&empty($user->admin)&&!$user->hasRight('mrp','read'))throw new RuntimeException('Missing production order permission');
    $sql='SELECT rowid FROM '.MAIN_DB_PREFIX.$table.' WHERE rowid='.(int)$id.' AND entity='.(int)$GLOBALS['conf']->entity;
    $rs=$db->query($sql);
    if(!$rs||!$db->fetch_object($rs))throw new RuntimeException('Transaction not found in this entity');
    $db->free($rs);
}
