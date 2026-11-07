<?php
/** Pure aggregation, Binloc read adapter, and order picking helpers. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

/** Locate bins from Binloc assignments without updating any Binloc record. */
function qrr_bin_suggestions($db, $wid) {
    if ($wid < 1) return array();
    $file = dol_buildpath('/binloc/class/binlocproductlocation.class.php', 0);
    $helper = dol_buildpath('/binloc/lib/binloc.lib.php', 0);
    if (!is_file($file) || !is_file($helper)) return array();
    try {
        require_once $helper;
        require_once $file;
        $levels = binloc_get_warehouse_levels($db, (int)$wid);
        $loc = new BinlocProductLocation($db);
        $rows = $loc->fetchAllByWarehouse((int)$wid);
        $prefix = function_exists('binloc_get_warehouse_code') ? binloc_get_warehouse_code($db, (int)$wid) : '';
        $out = array();
        foreach ($rows as $row) {
            if (empty($row->values)) continue;
            $code = (string)$prefix.binloc_compact_code($levels, $row->values);
            if ($code !== '' && qrr_bin_valid($code)) $out[$code] = $code;
        }
        natcasesort($out);
        return array_values($out);
    } catch (Throwable $e) {
        dol_syslog('QR Router: Binloc read failed: '.$e->getMessage(), LOG_WARNING);
        return array();
    }
}
/** Produce individual tracked rows, and one total per product for generic items and boxes.
 * Unknown box quantities have their own count and never contribute to summed totals.
 */
function qrr_bin_summary($items, $wid, $bin, $products = array()) {
    $tracked = array(); $totals = array(); $unknown = array();
    foreach ($items as $item) {
        if (($item['type'] ?? '') === 'unassigned' || qrr_item_status($item)==='consumed' || !empty($item['pending_handoff']) || !empty($item['pending_operation']) || (int)($item['warehouse_id'] ?? 0) !== (int)$wid || (string)($item['bin'] ?? '') !== (string)$bin) continue;
        $pid = (int)($item['product_id'] ?? 0);
        $p = $products[$pid] ?? array('ref' => ($pid ? 'Product #'.$pid : 'Unassigned'), 'label'=>'');
        if ($item['type'] === 'tracked') {
            $item['_product'] = $p;
            $tracked[] = $item;
        } else {
            $key = (string)$pid;
            if (!isset($totals[$key])) $totals[$key] = array('product_id'=>$pid, 'product'=>$p, 'generic'=>0, 'box'=>0, 'unknown_boxes'=>0, 'codes'=>array());
            if ($item['type'] === 'generic') $totals[$key]['generic']++;
            if ($item['type'] === 'box') {
                if (!array_key_exists('qty',$item) || $item['qty'] === null) $totals[$key]['unknown_boxes']++;
                else $totals[$key]['box'] += (int)$item['qty'];
            }
            $totals[$key]['codes'][] = $item['code'];
        }
    }
    usort($tracked, function($a,$b){return strnatcasecmp((string)$a['code'], (string)$b['code']);});
    uasort($totals, function($a,$b){return strnatcasecmp($a['product']['ref'], $b['product']['ref']);});
    return array('tracked'=>$tracked, 'totals'=>array_values($totals));
}
/** Enumerate known physical bin positions from this module, plus read-only Binloc suggestions. */
function qrr_known_bins($items, $wid) {
    $bins = array();
    foreach ($items as $e) {
        if ((int)($e['warehouse_id'] ?? 0) === (int)$wid && !empty($e['bin'])) $bins[$e['bin']] = true;
    }
    $list = array_keys($bins); natcasesort($list); return array_values($list);
}
/** Totals per product/warehouse for a reconciliation warning, never modifies Dolibarr. */
function qrr_warehouse_summary($items, $wid) {
    $data = array();
    foreach ($items as $e) {
        if (($e['type'] ?? '') === 'unassigned' || qrr_item_status($e)==='consumed' || !empty($e['pending_handoff']) || !empty($e['pending_operation']) || (int)($e['warehouse_id'] ?? 0) !== (int)$wid || empty($e['product_id'])) continue;
        $p = (int)$e['product_id'];
        if (!isset($data[$p])) $data[$p] = array('known'=>0,'unknown'=>0);
        if ($e['type'] === 'box' && ($e['qty'] ?? null) === null) $data[$p]['unknown']++;
        else $data[$p]['known'] += ($e['type'] === 'box' ? (int)$e['qty'] : 1);
    }
    return $data;
}
/** Unshipped customer order quantity. No stock mutation. */
function qrr_order_lines($db, $id) {
    if ($id <= 0) return array();
    require_once DOL_DOCUMENT_ROOT.'/commande/class/commande.class.php';
    $cmd = new Commande($db);
    if ($cmd->fetch($id) <= 0) throw new RuntimeException('Order not found');
    if ((int)$cmd->entity !== (int)$GLOBALS['conf']->entity) throw new RuntimeException('Order outside current entity');
    $cmd->fetch_lines();
    $out = array();
    foreach ($cmd->lines as $line) {
        $pid = (int)($line->fk_product ?? 0);
        if (!$pid) continue;
        $qty = (float)($line->qty ?? 0);
        if ($qty <= 0) continue;
        $out[] = array('product_id'=>$pid,'qty'=>$qty,'ref'=>(string)($line->product_ref ?? ''),'label'=>(string)($line->product_label ?? $line->desc ?? ''));
    }
    return array('order'=>$cmd,'lines'=>$out);
}
/** Greedy allocation by existing bin code, tracked individually; independent stock amounts (no reservations). */
function qrr_pick_proposal($lines, $items, $wid, $products) {
    $available = array();
    foreach ($items as $item) {
        if (($item['type'] ?? '') === 'unassigned' || qrr_item_status($item)==='consumed' || !empty($item['pending_handoff']) || !empty($item['pending_operation']) || (int)($item['warehouse_id'] ?? 0) !== (int)$wid || empty($item['bin']) || empty($item['product_id'])) continue;
        $pid = (int)$item['product_id'];
        if ($item['type'] === 'box' && ($item['qty'] ?? null) === null) continue;
        $item['_available'] = $item['type'] === 'box' ? (int)$item['qty'] : 1;
        $available[$pid][] = $item;
    }
    foreach ($available as &$bucket) usort($bucket, function($a,$b){
        $c = strnatcasecmp($a['bin'], $b['bin']); return $c ?: strnatcasecmp($a['code'], $b['code']);
    });
    unset($bucket);
    $output = array();
    foreach ($lines as $line) {
        $pid = $line['product_id']; $remaining = (float)$line['qty'];
        $prod = $products[$pid] ?? array('ref'=>'Product #'.$pid,'label'=>$line['label']);
        if (isset($available[$pid])) foreach ($available[$pid] as &$item) {
            if ($remaining <= 0) break;
            $qty = (int)$item['_available'];
            if ($qty <= 0) continue;
            $take = min($remaining, $qty);
            $output[] = array('bin'=>$item['bin'],'code'=>$item['code'],'label'=>(string)($item['label']??''),'product'=>$prod,'take'=>$take,'type'=>$item['type']);
            $remaining -= $take;
            $item['_available'] -= $take;
        }
        unset($item);
        if ($remaining > 0) $output[] = array('bin'=>'NOT ALLOCATED','code'=>'','label'=>'','product'=>$prod,'take'=>$remaining,'type'=>'missing');
    }
    usort($output, function($a,$b){ return strnatcasecmp($a['bin'], $b['bin']); });
    return $output;
}
