<?php
/** Overview of printed batches and unused labels. Read-only. */
$res=0;if(is_file(__DIR__.'/../../main.inc.php'))$res=include __DIR__.'/../../main.inc.php';if(!$res)die('Missing Dolibarr main.inc.php');
require_once __DIR__.'/lib/qrrouter.lib.php';if(!qrr_read_right($user))accessforbidden();
$state=qrr_load_state();$stats=qrr_unassigned_batches($state);
$filter=(string)GETPOST('show','alphanohtml');$showAll=$filter==='all';
$needle=strtoupper(trim((string)GETPOST('search','alphanohtml')));
$shown=0;
qrr_layout_start('Unregistered QR labels');
print '<div class="qrr-panel"><div class="qrr-flex" style="justify-content:space-between;align-items:start"><div><h3 style="margin-top:0">'.(int)$stats['unassigned_total'].' unregistered labels</h3><p class="qrr-small">'.(int)$stats['remaining_batches'].' batches have labels available for registration. Printed labels do not add stock.</p></div><div class="qrr-flex">';
if(qrr_write_right($user))print '<a class="qrr-btn" href="'.qrr_h(qrr_link('print_codes.php')).'">Print new QR codes</a><a class="qrr-btn alt" href="'.qrr_h(qrr_link('register.php',array('start'=>1))).'">Register items</a>';
print '</div></div></div>';
print '<form method="get" class="qrr-flex qrr-noprint" style="margin-top:12px"><input class="qrr-input" name="search" style="max-width:300px" value="'.qrr_h($needle).'" placeholder="Batch ID or QR identifier"><label style="margin:0"><input type="checkbox" name="show" value="all"'.($showAll?' checked':'').'> Show fully registered batches</label><button class="qrr-btn alt">Filter</button></form>';
foreach($stats['batches'] as $id=>$batch){
    if(!$showAll && $batch['unassigned']===0)continue;
    if($needle!=='' && stripos($id,$needle)===false && !in_array($needle,$batch['codes'],true))continue;
    $shown++;
    print '<div class="qrr-panel"><div class="qrr-flex" style="justify-content:space-between;align-items:start"><div><h3 style="margin:0 0 4px">Batch '.qrr_h($id).'</h3><span class="qrr-small">'.qrr_h($batch['created_at']).' &middot; '.(int)$batch['total'].' printed &middot; <strong>'.(int)$batch['unassigned'].' unregistered</strong> &middot; '.(int)($batch['total']-$batch['unassigned']).' assigned</span></div><div class="qrr-flex">';
    if($batch['unassigned'])print '<a class="qrr-btn" href="'.qrr_h(qrr_link('batch_print.php',array('batch'=>$id,'unassigned'=>1))).'">Print remaining '.(int)$batch['unassigned'].'</a>';
    print '<a class="qrr-btn alt" href="'.qrr_h(qrr_link('batch_print.php',array('batch'=>$id))).'">Print entire batch</a></div></div>';
    $listed=0;
    if($batch['unassigned']){
        print '<div class="qrr-code-grid">';
        foreach($batch['codes'] as $code){if(($state['items'][$code]['type']??'')!=='unassigned')continue;
            print '<a class="qrr-code-tile" href="'.qrr_h(qrr_link('register.php',array('mode'=>'unique','step'=>'details','codes'=>$code))).'" title="Register '.qrr_h($code).'"><img src="'.qrr_h(qrr_link('qr.php',array('code'=>$code))).'" width="60" height="60" alt="QR"><span class="qrr-tag">'.qrr_h($code).'</span></a>';
            if(++$listed>=12)break;
        }
        print '</div>';
        if($batch['unassigned']>12)print '<p class="qrr-small">Showing the first 12 unregistered labels in this batch. Use Print remaining to view the full sheet.</p>';
    }
    print '</div>';
}
if(!$shown)print '<div class="qrr-panel"><p>No matching QR batches.</p></div>';
if($stats['unbatched']){
    print '<div class="qrr-panel"><h3>Other unregistered QR labels ('.count($stats['unbatched']).')</h3><p class="qrr-small">Labels created outside printable batches.</p><div class="qrr-code-grid">';
    $shownOther=0;
    foreach($stats['unbatched'] as $code){if($needle!=='' && stripos($code,$needle)===false)continue;
      print '<a class="qrr-code-tile" href="'.qrr_h(qrr_link('register.php',array('mode'=>'unique','step'=>'details','codes'=>$code))).'"><img src="'.qrr_h(qrr_link('qr.php',array('code'=>$code))).'" width="60" height="60" alt="QR"><span class="qrr-tag">'.qrr_h($code).'</span></a>';
      if(++$shownOther>=24)break;
    }
    print '</div></div>';
}
qrr_layout_end();
