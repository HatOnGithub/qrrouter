<?php
/** Native warehouse stock transfers for QR handoffs. Does not modify core or Binloc. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

function qrr_stock_write_right($user) {
    return qrr_write_right($user) && (!empty($user->admin) || $user->hasRight('stock', 'mouvement', 'creer'));
}
function qrr_native_batch($db, $product, $item, $warehouseId, $qty) {
    $batch = trim((string)($item['native_batch'] ?? ''));
    if (!$product->hasbatch()) return array('', 0, 0);
    if ($batch === '') throw new RuntimeException('This Dolibarr product uses native lot/serial tracking. Assign the actual Dolibarr batch/serial in the tracked QR record first.');
    // Source batch must be present, and contain enough units.
    $sql = 'SELECT b.qty, b.eatby, b.sellby FROM '.MAIN_DB_PREFIX.'product_batch b';
    $sql .= ' INNER JOIN '.MAIN_DB_PREFIX.'product_stock s ON s.rowid=b.fk_product_stock';
    $sql .= ' WHERE s.fk_product='.(int)$product->id.' AND s.fk_entrepot='.(int)$warehouseId;
    $sql .= " AND b.batch='".$db->escape($batch)."'";
    $r = $db->query($sql);
    if (!$r) throw new RuntimeException('Cannot check native batch stock: '.$db->lasterror());
    $obj = $db->fetch_object($r);
    if (!$obj || (float)$obj->qty + 0.00001 < $qty) throw new RuntimeException('Not enough stock in the recorded native lot/serial in the source warehouse.');
    $eatby = $obj->eatby ? $db->jdate($obj->eatby) : 0;
    $sellby = $obj->sellby ? $db->jdate($obj->sellby) : 0;
    return array($batch, $eatby, $sellby);
}
/** Return signed movements tagged with one unique inventory code. Read only. */
function qrr_transfer_evidence($db, $pending) {
    $sql = 'SELECT fk_entrepot, value, fk_product FROM '.MAIN_DB_PREFIX.'stock_mouvement WHERE inventorycode=\'';
    $sql .= $db->escape($pending['inventorycode'])."'";
    $res = $db->query($sql);
    if (!$res) throw new RuntimeException('Cannot verify Dolibarr transfer movements.');
    $out=0; $in=0; $extra=0;
    while ($m=$db->fetch_object($res)) {
        $pid=(int)$m->fk_product; $wid=(int)$m->fk_entrepot; $qty=(float)$m->value;
        if ($pid===(int)$pending['product_id'] && $wid===(int)$pending['from'] && abs($qty+(int)$pending['qty'])<0.00001) $out++;
        elseif ($pid===(int)$pending['product_id'] && $wid===(int)$pending['to'] && abs($qty-(int)$pending['qty'])<0.00001) $in++;
        else $extra++;
    }
    return array('out'=>$out,'in'=>$in,'extra'=>$extra);
}
function qrr_transfer_evidence_complete($e) { return $e['out'] === 1 && $e['in'] === 1 && $e['extra'] === 0; }
function qrr_transfer_evidence_none($e) { return $e['out'] === 0 && $e['in'] === 0 && $e['extra'] === 0; }
/** Execute the same native Product::correct_stock[_batch] transfer pattern as Dolibarr 21. */
function qrr_do_native_transfer($db, $user, $item, $pending) {
    $pid=(int)$pending['product_id']; $from=(int)$pending['from']; $to=(int)$pending['to']; $qty=(int)$pending['qty'];
    if (!$pid || !$from || !$to || $from===$to || $qty<1) throw new RuntimeException('Invalid warehouse transfer');
    require_once DOL_DOCUMENT_ROOT.'/product/stock/class/entrepot.class.php';
    foreach(array($from,$to) as $whid){
        $warehouse=new Entrepot($db);
        if($warehouse->fetch($whid)<=0)throw new RuntimeException('Warehouse is unavailable');
        if((int)$warehouse->status === (int)Entrepot::STATUS_CLOSED)throw new RuntimeException('Cannot transfer stock to or from a closed warehouse');
    }
    if (qrr_stock_qty($db,$pid,$from)+0.00001 < $qty) throw new RuntimeException('Insufficient stock in source warehouse');
    $product=qrr_product($db,$pid);
    if (!$product || (int)$product->type !== 0) throw new RuntimeException('Only physical Dolibarr products may be checked out');
    if (!$db->begin()) throw new RuntimeException('Cannot start native stock transaction');
    try {
        $product->load_stock('novirtual');
        list($batch,$eatby,$sellby)=qrr_native_batch($db,$product,$item,$from,$qty);
        $label='QR '.($pending['kind']==='checkout'?'check-out':'check-in').' '.$item['code'].' / user '.$pending['person_id'];
        $inventorycode=$pending['inventorycode'];
        $price=isset($product->pmp)?(float)$product->pmp:0.0;
        if ($product->hasbatch()) {
            $r1=$product->correct_stock_batch($user,$from,$qty,1,$label,$price,$eatby,$sellby,$batch,$inventorycode);
            if ($r1 < 0) throw new RuntimeException('Native stock decrease failed: '.($product->error ?: implode('; ',(array)$product->errors)));
            $r2=$product->correct_stock_batch($user,$to,$qty,0,$label,$price,$eatby,$sellby,$batch,$inventorycode);
        } else {
            $r1=$product->correct_stock($user,$from,$qty,1,$label,$price,$inventorycode);
            if ($r1 < 0) throw new RuntimeException('Native stock decrease failed: '.($product->error ?: implode('; ',(array)$product->errors)));
            $r2=$product->correct_stock($user,$to,$qty,0,$label,$price,$inventorycode);
        }
        if ($r2 < 0) throw new RuntimeException('Native stock increase failed: '.($product->error ?: implode('; ',(array)$product->errors)));
        if ($db->commit() <= 0) throw new RuntimeException('Dolibarr stock transaction commit failed; reconcile before retrying.');
    } catch (Throwable $e) { $db->rollback(); throw $e; }
}
/** Durable staged state: if the PHP request crashes after stock commit, reconcile using inventorycode. */
function qrr_stage_handoff($db,$user,$code,$kind,$personId,$reason,$warehouses,$users) {
    if (!qrr_stock_write_right($user)) throw new RuntimeException('QR management and native stock-movement permissions are required.');
    if ($kind==='checkout' && !isset($users[$personId])) throw new RuntimeException('Choose an active employee');
    if (!in_array($kind,array('checkout','checkin'),true)) throw new RuntimeException('Invalid handoff type');
    return qrr_update(function (&$state) use ($db,$code,$kind,$personId,$reason,$warehouses) {
        $e =& $state['items'][$code];
        if (!is_array($e ?? null)) throw new RuntimeException('Unknown item');
        if (!empty($e['pending_handoff'])) throw new RuntimeException('Unresolved stock handoff; reconcile it first.');
        if (!(int)$e['product_id'] || !(int)$e['warehouse_id']) throw new RuntimeException('Link a product and an originating warehouse first.');
        $loan=qrr_loan_data($e);
        if ($kind==='checkout' && $loan) throw new RuntimeException('Item is already checked out');
        if ($kind==='checkin' && !$loan) throw new RuntimeException('Item is not checked out');
        if ($kind==='checkin' && (int)$loan['user_id']!==$personId) throw new RuntimeException('Borrower does not match');
        $mapping=$state['personal_warehouses'];
        $personal=(int)($mapping[$personId] ?? 0);
        if (!$personal || !isset($warehouses[$personal])) throw new RuntimeException('Assign an active personal warehouse for this employee in the QR Router settings.');
        $qty=qrr_item_units($e);
        $from=(int)$e['warehouse_id'];
        $to=$kind==='checkout' ? $personal : (int)$loan['origin_warehouse_id'];
        if ($kind==='checkin' && (int)$e['warehouse_id'] !== $personal) throw new RuntimeException('Item is not located in this employee personal warehouse');
        if (!isset($warehouses[$from]) || !isset($warehouses[$to]) || $from === $to) throw new RuntimeException('Source and personal destination warehouse must be distinct and accessible.');
        require_once DOL_DOCUMENT_ROOT.'/product/stock/class/entrepot.class.php';
        foreach(array($from,$to) as $warehouseId){
            $w=new Entrepot($db);
            if($w->fetch($warehouseId)<=0 || (int)$w->status===(int)Entrepot::STATUS_CLOSED)
                throw new RuntimeException('Source or personal warehouse is closed or unavailable; no handoff was staged');
        }
        $product=qrr_product($db,(int)$e['product_id']);
        if (!$product || (int)$product->type !== 0) throw new RuntimeException('A stock-managed physical Dolibarr product is required.');
        if (qrr_stock_qty($db,(int)$e['product_id'],$from)+0.00001 < $qty) throw new RuntimeException('Insufficient Dolibarr stock in source warehouse');
        // Fail before staging when a required native lot/serial cannot be matched.
        qrr_native_batch($db,$product,$e,$from,$qty);
        $token='QRR-'.strtoupper(bin2hex(random_bytes(10)));
        $p=array('id'=>$token,'inventorycode'=>$token,'kind'=>$kind,'person_id'=>$personId,'from'=>$from,'to'=>$to,'qty'=>$qty,'product_id'=>(int)$e['product_id'],'reason'=>$reason,'at'=>gmdate('c'));
        $e['pending_handoff']=$p;
        return $p;
    },$user,'handoff_stage',array('code'=>$code,'kind'=>$kind,'person_id'=>$personId));
}
function qrr_finish_handoff($db,$user,$code,$pending) {
    $proof=qrr_transfer_evidence($db,$pending);
    if (!qrr_transfer_evidence_complete($proof)) throw new RuntimeException('Native stock transfer evidence is incomplete. Resolve manually before changing QR location.');
    qrr_update(function (&$state) use ($code,$pending) {
        $e =& $state['items'][$code];
        if (!$e || ($e['pending_handoff']['id']??'') !== $pending['id']) throw new RuntimeException('Pending handoff changed unexpectedly');
        if ($pending['kind']==='checkout') {
            $e['checkout']=array('user_id'=>$pending['person_id'],'reason'=>$pending['reason'],'at'=>gmdate('c'),'origin_warehouse_id'=>(int)$pending['from'],'origin_bin'=>$e['bin'],'origin_bin_key'=>$e['bin_key']??'','origin_bin_values'=>$e['bin_values']??array());
            $e['warehouse_id']=(int)$pending['to']; $e['bin']='';$e['bin_key']='';$e['bin_values']=array();
        } else {
            $loan=$e['checkout']??null;
            if (!$loan) throw new RuntimeException('Loan data missing');
            $e['warehouse_id']=(int)$pending['to'];$e['bin']=$loan['origin_bin']??'';$e['bin_key']=$loan['origin_bin_key']??'';$e['bin_values']=$loan['origin_bin_values']??array();
            unset($e['checkout']);
        }
        $e['updated_at']=gmdate('c'); unset($e['pending_handoff']);
    },$user,'handoff_complete',array('code'=>$code,'kind'=>$pending['kind'],'person_id'=>$pending['person_id'],'inventorycode'=>$pending['inventorycode']));
}
/** Reconcile a crashed operation: no evidence -> cancel; exactly two -> finalize; partial -> block. */
function qrr_reconcile_handoff($db,$user,$code,$pending) {
    if (!qrr_stock_write_right($user)) throw new RuntimeException('Stock movement permission required');
    if (time() - (strtotime($pending['at'] ?? '') ?: time()) < 30) throw new RuntimeException('A transfer may still be running. Only reconcile after the transfer request has finished or failed.');
    $e=qrr_transfer_evidence($db,$pending);
    if (qrr_transfer_evidence_complete($e)) { qrr_finish_handoff($db,$user,$code,$pending); return 'Completed from native transfer evidence.'; }
    if (!qrr_transfer_evidence_none($e)) throw new RuntimeException('Partial or conflicting stock movement evidence: investigate native stock history. No automatic retry.');
    qrr_update(function (&$state) use($code,$pending) {
        $item =& $state['items'][$code];
        if (!$item || ($item['pending_handoff']['id']??'')!==$pending['id']) throw new RuntimeException('Pending handoff changed');
        unset($item['pending_handoff']);
    },$user,'handoff_cancel_no_stock',array('code'=>$code,'inventorycode'=>$pending['inventorycode']));
    return 'Pending handoff cancelled (no native stock movements were recorded).';
}
