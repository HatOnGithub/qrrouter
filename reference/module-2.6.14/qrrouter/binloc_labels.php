<?php
/** Per-warehouse local labels for Binloc: display only, never inventory identity. */
$res = 0;
if (is_file(__DIR__.'/../../main.inc.php')) $res = include __DIR__.'/../../main.inc.php';
if (!$res) die('Dolibarr main.inc.php missing');
require_once __DIR__.'/lib/qrrouter.lib.php';
if (!qrr_write_right($user) || !qrr_products_right($user)) accessforbidden();
$warehouses=qrr_warehouses($db);
$wid=(int)GETPOST('warehouse_id','int');
if (!$wid || !isset($warehouses[$wid])) $wid=(int)(array_key_first($warehouses) ?? 0);
$error=''; $saved=false; $levels=array();
try {
    if ($wid) $levels=qrr_binloc_levels($db,$wid);
    if ($_SERVER['REQUEST_METHOD']==='POST') {
        qrr_check_post();
        if (!isset($warehouses[$wid])) throw new RuntimeException('Invalid warehouse');
        $prefs=qrr_binloc_validate_label_settings($levels, $_POST['format'] ?? array());
        qrr_update(function (&$state) use($wid,$prefs) {
            if (!isset($state['binloc_label_settings']) || !is_array($state['binloc_label_settings'])) $state['binloc_label_settings']=array();
            $state['binloc_label_settings'][(string)$wid]=$prefs;
        }, $user, 'set_local_binloc_label', array('warehouse_id'=>$wid));
        $saved=true;
    }
} catch (Throwable $e) { $error=$e->getMessage(); }
$setting=qrr_binloc_label_settings($wid);
if ($_SERVER['REQUEST_METHOD']==='POST' && $error !== '' && is_array($_POST['format']??null)) {
    $setting=array('enabled'=>true,'show'=>array_fill_keys(array_keys($_POST['format']['show']??array()),1),'separator'=>$_POST['format']['separator']??array(),'show_warehouse'=>!empty($_POST['format']['show_warehouse']));
}
qrr_layout_start('Binloc local label format');
if ($error) print '<div class="qrr-alert">'.qrr_h($error).'</div>';
if ($saved) print '<div class="qrr-ok">Local label format saved. Existing QR inventory locations were not modified.</div>';
print '<div class="qrr-panel"><p>For labels placed within an already marked aisle or rack, display only the local levels needed to identify the position. The complete Binloc hierarchy and original location code remain stored for inventory tracking.</p>';
print '<form method="get" class="qrr-flex"><label>Warehouse '.qrr_warehouse_select($warehouses,$wid).'</label><button class="qrr-btn alt">Load levels</button></form>';
if (!$levels) { print '<p>No levels configured for this warehouse. Configure them in Binloc first.</p></div>';qrr_layout_end();exit; }
print '<form method="post">'.qrr_form_token().'<input type="hidden" name="warehouse_id" value="'.$wid.'">';
print '<table class="qrr-table"><thead><tr><th>Binloc level</th><th>Show on local label</th><th>Separator before this level</th></tr></thead><tbody>';
foreach ($levels as $id=>$cfg) {
    $id=(int)$id;
    $show = $setting===null || !empty($setting['show'][(string)$id]);
    $separator=$setting['separator'][(string)$id] ?? '-';
    $sample=(string)$cfg->label;
    if (($cfg->datatype==='list' || $cfg->datatype==='letter') && !empty($cfg->options)) {foreach ($cfg->options as $opt) {$sample=(string)$opt->value;break;}}
    print '<tr data-binloc-sample="'.qrr_h($sample).'"><td><strong>'.qrr_h($cfg->label).'</strong><div class="qrr-small">'.qrr_h($cfg->datatype).'</div></td>';
    print '<td><label><input type="checkbox" name="format[show]['.$id.']" value="1"'.($show?' checked':'').'> Include</label></td>';
    print '<td><input class="qrr-input" style="max-width:220px" name="format[separator]['.$id.']" maxlength="12" value="'.qrr_h($separator).'" placeholder="(nothing)" aria-label="Separator before '.qrr_h($cfg->label).'"></td></tr>';
}
print '</tbody></table>';
print '<p><label><input type="checkbox" name="format[show_warehouse]" value="1"'.(!empty($setting['show_warehouse'])?' checked':'').'> Include warehouse reference in the local label</label></p>';
print '<p class="qrr-small">A separator is inserted before a level only if another visible value precedes it. Leave the separator empty to join values without punctuation. All levels remain available when assigning item locations, even when hidden from local labels.</p>';
print '<p><strong>Example local label:</strong> <code id="qrr-local-preview"></code></p>';
print '<p><button type="submit" class="qrr-btn">Save label format</button> <a class="qrr-btn alt" href="'.qrr_h(qrr_link('bins.php',array('warehouse_id'=>$wid))).'">View bin printouts</a></p>';
print '</form></div>';
print '<script>(function(){const rows=document.querySelectorAll("tr[data-binloc-sample]");const output=document.getElementById("qrr-local-preview");const prefix=document.querySelector("input[name=\"format[show_warehouse]\"]");function update(){let label="";if(prefix.checked)label='.json_encode($warehouses[$wid]['ref'] ?? '', JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT).';for(const row of rows){if(!row.querySelector("input[type=checkbox]").checked)continue;const part=row.dataset.binlocSample;if(!part)continue;if(label)label+=row.querySelector("input.qrr-input").value;label+=part;}output.textContent=label||"(select at least one level)";}document.querySelectorAll("form input").forEach(el=>el.addEventListener("input",update));update();})();</script>';
qrr_layout_end();
