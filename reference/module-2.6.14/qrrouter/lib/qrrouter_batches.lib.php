<?php
/** Pure read-only printed-label batch aggregation. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;
function qrr_unassigned_batches($state) {
    $items=(array)($state['items']??array());
    $rows=array();$inBatches=array();$hasRemaining=0;
    foreach((array)($state['batches']??array()) as $id=>$raw){
        if(!is_array($raw))continue;
        $codes=array_values(array_unique(array_filter((array)($raw['codes']??array()),'qrr_code_valid')));
        $unused=0;
        foreach($codes as $code){$inBatches[$code]=true;if(($items[$code]['type']??null)==='unassigned')$unused++;}
        if($unused)$hasRemaining++;
        $rows[(string)$id]=array('total'=>count($codes),'unassigned'=>$unused,'codes'=>$codes,'created_at'=>(string)($raw['created_at']??''));
    }
    uksort($rows,function($a,$b)use($rows){
        $t1=strtotime($rows[$a]['created_at'])?:0;$t2=strtotime($rows[$b]['created_at'])?:0;
        return $t2<=>$t1 ?: strcmp($b,$a);
    });
    $unbatched=array();$total=0;
    foreach($items as $code=>$item){
        if(($item['type']??null)!=='unassigned')continue;
        $total++;
        if(!isset($inBatches[$code]))$unbatched[]=$code;
    }
    sort($unbatched,SORT_NATURAL);
    return array('unassigned_total'=>$total,'remaining_batches'=>$hasRemaining,'batches'=>$rows,'unbatched'=>$unbatched);
}
