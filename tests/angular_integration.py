"""Test Angular's PHP gateway with a real C# service and mock Dolibarr native APIs.

Use --browser to also run Playwright against the built, PHP-hosted Angular application.
"""
import argparse
import contextlib
import http.cookiejar
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import dolibarr_fixture as fixture
import native_fixture as native_contract
from sqlite_fixture import read_state, write_state
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor, urlopen

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--php', default='php')
parser.add_argument('--extension-dir')
parser.add_argument('--browser', action='store_true')
args = parser.parse_args()
php = [str(Path(args.php).resolve())] if Path(args.php).is_file() else [args.php]
if args.extension_dir:
    php += ['-n', '-d', 'extension_dir=' + str(Path(args.extension_dir).resolve()), '-d', 'extension=curl']
for path in (root / 'dolibarr/qrrouter').rglob('*.php'):
    subprocess.run(php + ['-l', str(path)], check=True, stdout=subprocess.DEVNULL)
print('All PHP adapter files pass syntax checks.', flush=True)
subprocess.run(php + [str(root / 'tests/test_translation.php')], check=True)
subprocess.run(php + [str(root / 'tests/test_service_settings.php')], check=True)
subprocess.run(php + [str(root / 'tests/test_labels.php')], check=True)



def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait(url, proc):
    for _ in range(100):
        if proc.poll() is not None:
            raise RuntimeError('Fixture server stopped unexpectedly')
        try:
            with urlopen(url, timeout=1):
                return
        except (URLError, ConnectionError, TimeoutError):
            time.sleep(.1)
    raise TimeoutError('Fixture server did not start')


with tempfile.TemporaryDirectory(prefix='qrrouter-angular-') as directory:
    tmp = Path(directory)
    webroot = tmp / 'htdocs'
    data = tmp / 'data'
    data.mkdir()
    shutil.copytree(root / 'dolibarr/qrrouter', webroot / 'custom/qrrouter')
    for folder in ['product/class', 'product/stock/class', 'custom/binloc/class', 'custom/binloc/lib', 'commande/class', 'core/lib', 'core/modules']:
        (webroot / folder).mkdir(parents=True, exist_ok=True)
    main = fixture.MAIN.replace("if(str_contains($sql,'FROM llx_entrepot')){", "if(str_contains($sql,'FROM llx_product WHERE')){$this->rows=[(object)['rowid'=>3,'ref'=>'PART-003','label'=>'Fixture Part']];}elseif(str_contains($sql,'FROM llx_entrepot')){")
    main = main.replace("elseif(str_contains($sql,'FROM llx_entrepot')){", 'else' + native_contract.QUERIES.lstrip())
    main = main.replace("'label'=>'Fixture Part']];", "'label'=>'Fixture Part'],(object)['rowid'=>4,'ref'=>'SERIAL-004','label'=>'Tracked Part']];")
    main = main.replace('$this->idx=0;$s=$this->state();', '$this->idx=0;$s=$this->txn??$this->state();')
    main = main.replace('<meta charset="utf-8">', '<meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:rgb(40,40,40);background:rgb(250,250,250)}.butAction{background:rgb(83,101,117);color:white;border:1px solid gray;border-radius:3px}.flat{background:white;color:rgb(40,40,40)}</style>')
    main = main.replace('function llxHeader($a,$title){print ', 'function llxHeader($a,$title){global $conf; print ')
    main = main.replace('function llxFooter()', '''function dol_get_fiche_head($head,$selected,$title='',$notab=0,$picto='') {
 $html='<nav data-native-tabs>';foreach($head as $tab)$html.='<a href="'.htmlspecialchars($tab[0]).'">'.htmlspecialchars($tab[1]).'</a>';return $html.'</nav>';
}
function dol_get_fiche_end(){return '';}
function llxFooter()''')
    main = main.replace("</head><body><main data-title=", "</head><body>'.(empty($conf->dol_hide_leftmenu)?'<aside id=\"id-left\">Native left menu</aside>':'').'<main data-title=")
    main = main.replace("elseif(str_contains($sql,'FROM llx_user')){", "elseif(str_contains($sql,'FROM llx_user')){ if (!empty($s['users_empty'])) return true;")
    main = main.replace("$GLOBALS['db']=new FakeDB();", """
$GLOBALS['db']=new FakeDB();
$GLOBALS['conf']->entity = max(1, (int) ($_GET['entity'] ?? 1));
$GLOBALS['conf']->global = (object) ($GLOBALS['db']->state()['constants'][(string) $GLOBALS['conf']->entity] ?? []);
""")
    locale_fixture = fixture.LANGS
    entity_text = (
        'Tools &amp; parts&hellip; &mdash; &quot;quoted&quot; &#39;single&#39; '
        '&lt;img src=&quot;entity-regression&quot; '
        'onerror=&quot;window.__entityExecuted=true&quot;&gt;'
    )
    entity_expected = (
        'Tools & parts… — "quoted" \'single\' '
        '<img src="entity-regression" onerror="window.__entityExecuted=true">'
    )
    inventory_key = 'QRRUI_' + hashlib.sha1(b'Inventory').hexdigest()[:12]
    locale_fixture = locale_fixture.replace(
        "public function trans($key){return $this->map[$key]??$key;}",
        """public function trans($key) {
  return htmlentities($this->transnoentitiesnoconv($key), ENT_QUOTES | ENT_HTML5, 'UTF-8');
 }
 public function transnoentitiesnoconv($key) {
  if (!empty($_GET['testentities']) && $key === '%s') return '%s';
  return $this->map[$key] ?? $key;
 }""" % (inventory_key, entity_text),
    )
    before_return, _, after_return = main.rpartition('return 1;')
    main = before_return + locale_fixture + '\nreturn 1;' + after_return
    main = main.replace("$GLOBALS['user']=new class {public $id=8,$admin=1;public function hasRight(...$a){return true;}};", """
$role=$_GET['role']??'admin';
$GLOBALS['user']=new class($role) {
 public $id=8,$admin,$socid=0,$statut=1; private $role;
 public function __construct($role){$this->role=$role;$this->admin=in_array($role,['admin','external-admin'],true)?1:0;if(str_starts_with($role,'external'))$this->socid=77;if($role==='inactive')$this->statut=0;if($role==='anonymous')$this->id=0;}
 public function hasRight(...$a){
  if($this->admin)return true;
  if($a===['qrrouter','read'])return $this->role!=='no-qr';
  if($a===['produit','lire'])return $this->role!=='no-product';
  if($a===['service','lire'])return true;
  if($a===['categorie','lire'])return $this->role!=='no-tags';
  if($a===['stock','lire'])return $this->role!=='no-stock';
  if($a===['binloc','read'])return $this->role!=='no-binloc';
  if($a===['commande','lire'])return $this->role!=='operator';
  if($a===['mrp','read']||$a===['expedition','lire'])return false;
  if($a===['qrrouter','manage'])return in_array($this->role,['manager','operator','restricted'],true);
  if($a===['stock','mouvement','creer']||$a===['produit','creer']||$a===['binloc','write'])return $this->role==='operator';
  return false;
 }
};
function isModEnabled($module){$role=$_GET['role']??'';return !(($module==='qrrouter'&&$role==='disabled')||$role==='disabled-'.$module);}
function restrictedArea($actor,$feature,$id=0,$table='',$feature2='',$key='fk_soc',$select='rowid',$draft=0,$mode=0){
 if($mode!==1)throw new RuntimeException('Object checks must use non-terminating mode');
 $allowed=['produit'=>[3,4],'stock'=>[1,2],'commande'=>[39],'mrp'=>[19],'expedition'=>[29],'user'=>[8,9]];
 return in_array((int)$id,$allowed[$feature]??[],true)&&!(($_GET['role']??'')==='restricted'&&$feature==='commande')?1:0;
}
""")
    commande = """<?php
class Commande { public $entity=1,$ref='SO-0039',$lines=[]; public function __construct($db){} public function fetch($id){return (int)$id===39?1:-1;} public function fetch_lines(){$this->lines=[(object)['fk_product'=>3,'qty'=>3,'product_ref'=>'PART-003','product_label'=>'Fixture Part']];} }
"""
    admin = """<?php
function dolibarr_set_const($db, $name, $value, $type='chaine', $visible=0, $note='', $entity=1) {
    global $conf;
    if ($visible !== 0 || $entity !== $conf->entity) throw new RuntimeException('Invalid constant scope');
    $state = $db->txn ?? $db->state();
    if (($state['fail_setting'] ?? '') === $name) return -1;
    $state['constants'][(string) $entity][$name] = $value;
    if ($db->txn !== null) $db->txn = $state; else $db->save($state);
    $conf->global->$name = $value;
    return 1;
}
function setEventMessages($message, $errors=null, $style='mesgs') {}
"""
    product = fixture.PRODUCT.replace("public $id,$type=0", "public $entity=1; public $id,$type=0")
    product = product.replace('$this->id=(int)$id;', "$this->id=(int)$id;$this->entity=(int)($this->db->state()['product_entities'][$id]??1);")
    product = product.replace('public function hasbatch(){return false;}', 'public function hasbatch(){return $this->id===4;}'+native_contract.PRODUCT_METHOD)
    for target, content in {'main.inc.php': main, 'product/class/product.class.php': product,
                            'core/class/extrafields.class.php': fixture.EXTRAFIELDS,
                            'categories/class/categorie.class.php': fixture.CATEGORIES,
                            'product/stock/class/entrepot.class.php': fixture.WAREHOUSE.replace('public $status=1', 'public $id; public $status=1').replace('public function fetch($wid){', 'public function fetch($wid){$this->id=(int)$wid;'),
                            'product/stock/class/productlot.class.php': native_contract.LOT,
                            'custom/binloc/class/binlocwarehouselevel.class.php': native_contract.LEVELS,
                            'custom/binloc/class/binlocproductlocation.class.php': native_contract.LOCATION,
                            'custom/binloc/lib/binloc.lib.php': native_contract.LIBRARY,
                            'commande/class/commande.class.php': commande,
                            'native.php': "<?php require __DIR__.'/main.inc.php'; llxHeader('', 'Native Dolibarr page'); llxFooter();",
                            'core/lib/product.lib.php': """<?php
function product_prepare_head($object){return [['/product/card.php?id='.$object->id,'Product','card'],['/custom/binloc/tab_product_locations.php?id='.$object->id,'Binloc','binloc'],['/custom/qrrouter/native.php?kind=product&id='.$object->id,'QR entries','qrrouter']];}
function productlot_prepare_head($object){return [['/product/stock/productlot_card.php?id='.$object->id,'Lot','card'],['/custom/qrrouter/native.php?kind=lot&id='.$object->id,'QR entries','qrrouter']];}
""",
                            'core/lib/stock.lib.php': """<?php
function stock_prepare_head($object){return [['/product/stock/card.php?id='.$object->id,'Warehouse','card'],['/custom/binloc/tab_warehouse_locations.php?id='.$object->id,'Binloc','binloc'],['/custom/qrrouter/native.php?kind=warehouse&id='.$object->id,'QR entries','qrrouter']];}
""",
                            'custom/qrrouter/hook_fixture.php': """<?php
require __DIR__.'/../../main.inc.php';
require __DIR__.'/class/actions_qrrouter.class.php';
$object=(object)['id'=>(int)GETPOST('id','int')]; $action=(string)GETPOST('action');
$hooks=new ActionsQrrouter($db); $hooks->addMoreActionsButtons(['currentcontext'=>(string)GETPOST('context')],$object,$action);
""",
                            'core/modules/DolibarrModules.class.php': "<?php #[AllowDynamicProperties] class DolibarrModules {}",
                            'custom/qrrouter/descriptor_fixture.php': """<?php
require __DIR__.'/../../main.inc.php';
require __DIR__.'/core/modules/modQrrouter.class.php';
$module=new modQrrouter($db);
echo json_encode(['parts'=>$module->module_parts,'tabs'=>$module->tabs,'allowed'=>eval('return '.$module->menu[1]['perms'].';')]);
""",
                            'core/lib/admin.lib.php': admin}.items():
        (webroot / target).parent.mkdir(parents=True, exist_ok=True)
        (webroot / target).write_text(content, encoding='utf-8')
    native_path = data / 'native.json'
    native_path.write_text(json.dumps({'warehouses': {'1': {'ref': 'MAIN', 'lieu': 'Main', 'status': 1}, '2': {'ref': 'OTHER', 'lieu': 'Other', 'status': 1}},
                                       'stock': {'3': {'1': 30, '2': 4}}, 'movements': [], 'users_empty': True}))
    api_base = f'http://127.0.0.1:{port()}'
    web_base = f'http://127.0.0.1:{port()}'
    key = secrets.token_hex(32)
    service_env = dict(os.environ, AppSettings__ApiKey=key, AppSettings__DataDirectory=str(data / 'qrrouter'), ASPNETCORE_URLS=api_base)
    php_env = dict(os.environ)
    for name in ['QRR_SERVICE_URL', 'QRR_SERVICE_API_KEY']:
        php_env.pop(name, None)
    service_log = open(tmp / 'service.log', 'w', encoding='utf-8')
    php_log = open(tmp / 'php.log', 'w', encoding='utf-8')
    service = subprocess.Popen(['dotnet', str(root / 'src/QrRouterApi/bin/Release/net10.0/QrRouterApi.dll')], env=service_env, cwd=root, stdout=service_log, stderr=service_log)
    php_server = None
    passed = 0
    try:
        wait(api_base + '/health', service)
        php_server = subprocess.Popen(php + ['-S', web_base.removeprefix('http://'), '-t', str(webroot)], env=php_env, stdout=php_log, stderr=php_log)
        wait(web_base + '/custom/qrrouter/index.php', php_server)
        client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        base = web_base + '/custom/qrrouter/'

        def request(resource='bootstrap', action=None, payload=None, role='admin', csrf=None, expected=200, params=None):
            global_params = {'role': role, 'action': action} if action else {'role': role, 'resource': resource}
            global_params.update(params or {})
            body = None if action is None else urlencode({'payload': json.dumps(payload), 'token': 'fixture-dolibarr-token', 'qrr_token': csrf or bootstrap['csrf']}).encode()
            try:
                with client.open(base + 'api.php?' + urlencode(global_params), body, timeout=15) as response:
                    status, raw = response.status, response.read()
            except HTTPError as error:
                status, raw = error.code, error.read()
            try:
                result = json.loads(raw)
            except json.JSONDecodeError:
                raise AssertionError((status, raw[:1500])) from None
            assert status == expected, (action or resource, status, expected, result)
            return result.get('result') if action else result

        def settings_request(form=None, role='admin', entity=1, expected=200):
            url = base + 'admin/setup.php?' + urlencode({'role': role, 'entity': entity})
            body = None if form is None else urlencode(form).encode()
            try:
                with client.open(url, body, timeout=15) as response:
                    status, html = response.status, response.read().decode()
            except HTTPError as error:
                status, html = error.code, error.read().decode()
            assert status == expected, ('module settings', status, expected)
            assert key not in html, 'Saved API key exposed in settings HTML'
            return html

        assert 'module settings' in request(expected=409)['message']
        settings_html = settings_request()
        csrf = re.search(r'name="qrr_token" value="([^"]+)"', settings_html)[1]
        settings_request(role='reader', expected=403)
        form = {'token': 'fixture-dolibarr-token', 'qrr_token': csrf,
                'service_url': api_base, 'service_api_key': key}
        settings_request(form, role='reader', expected=403)
        settings_request({**form, 'qrr_token': 'invalid'}, expected=403)
        settings_request({**form, 'service_api_key': ''}, expected=400)
        settings_request({**form, 'service_url': 'file:///tmp/not-a-service'}, expected=400)
        assert 'constants' not in json.loads(native_path.read_text())
        settings_request(form)
        stored = json.loads(native_path.read_text())['constants']['1']
        assert stored == {'QRR_SERVICE_URL': api_base, 'QRR_SERVICE_API_KEY': key}
        # Saving a blank password preserves the key and never renders it back to the browser.
        settings_html = settings_request({**form, 'service_api_key': ''})
        assert 'An API key is saved.' in settings_html
        assert re.search(r'name="service_api_key"\s+value=""', settings_html)
        assert json.loads(native_path.read_text())['constants']['1'] == stored
        settings_request({**form, 'service_url': 'http://different-service:8080', 'service_api_key': ''}, expected=400)
        assert json.loads(native_path.read_text())['constants']['1'] == stored
        # Failed second write must not leave the first constant changed.
        failing = json.loads(native_path.read_text())
        failing['fail_setting'] = 'QRR_SERVICE_API_KEY'
        native_path.write_text(json.dumps(failing))
        settings_request({**form, 'service_url': 'http://127.0.0.1:1'}, expected=500)
        failing = json.loads(native_path.read_text())
        assert failing['constants']['1'] == stored
        del failing['fail_setting']
        native_path.write_text(json.dumps(failing))
        settings_request({**form, 'service_url': 'http://entity-two:8080'}, entity=2)
        assert json.loads(native_path.read_text())['constants']['1'] == stored
        assert json.loads(native_path.read_text())['constants']['2']['QRR_SERVICE_URL'] == 'http://entity-two:8080'
        print('Module settings PASS: admin permissions, CSRF, validation, persistence, blank-key preservation, rollback, entity scope and no secret in HTML.', flush=True)

        bootstrap = request()
        assert bootstrap['state']['schema'] == 2 and bootstrap['permissions']['admin']
        assert bootstrap['users'] == {} and bootstrap['state']['items'] == {}
        for locale, translated in [('nl_NL', 'Voorraad'), ('fr_FR', 'Stock')]:
            with client.open(base + 'api.php?resource=bootstrap&testlang=' + locale) as response:
                localized = json.load(response)
                assert localized['locale'] == locale and localized['translations']['Inventory'] == translated
        with client.open(base + 'api.php?resource=bootstrap&testentities=1') as response:
            decoded = json.load(response)['translations']['Inventory']
            assert decoded == entity_expected
        populated = json.loads(native_path.read_text())
        populated['users_empty'] = False
        populated['stock']['4'] = {'1': 30, '2': 4}
        populated['lots'] = {'1': {'fk_product': 4, 'batch': 'SN-REGISTER', 'entity': 1}, '2': {'fk_product': 4, 'batch': 'Fixture box', 'entity': 1}, '3': {'fk_product': 4, 'batch': 'Browser container', 'entity': 1}}
        populated['batches'] = {'4': {'1': {'SN-REGISTER': 1, 'Fixture box': 5, 'Browser container': 7}, '2': {}}}
        native_path.write_text(json.dumps(populated))
        assert key not in json.dumps(bootstrap)
        request(action='bulk', payload={'count': 2, 'type': 'unassigned'}, csrf='invalid', expected=409)
        assert request()['state']['revision'] == 0
        request(action='bulk', payload={'count': 1}, role='reader', expected=403)
        forged = Request(base + 'api.php?role=reader&action=bulk', data=urlencode({
            'payload': json.dumps({'count': 1, 'type': 'unassigned'}), 'token': 'fixture-dolibarr-token', 'qrr_token': bootstrap['csrf']
        }).encode(), headers={'X-Qrr-Admin': '1', 'X-Qrr-Manage': '1', 'X-Qrr-Stock': '1', 'X-Qrr-Entity': '2'})
        try:
            client.open(forged)
            raise AssertionError('Browser-supplied actor headers were trusted')
        except HTTPError as error:
            assert error.code == 403
        request(action='finish', payload={'id': 'forged', 'proof': {'seen': [1]}}, expected=400)
        assert not request(role='reader')['permissions']['manage']
        batch = request(action='bulk', payload={'type': 'unassigned', 'count': 4, 'entity_id': 999, 'warehouses': {'999': {}}})
        codes = request()['state']['batches'][batch]['codes']
        assert len(codes) == 4
        tracked, box, generic, blank = codes
        for code, kind, qty in [(tracked, 'tracked', 1), (box, 'box', 5), (generic, 'generic', 1)]:
            result = request(action='register', payload={'type': kind, 'codes': [code], 'label': 'Fixture ' + kind, 'serial': 'SN-REGISTER' if kind == 'tracked' else '', 'details': 'Inspect seals annually; keep dry.' if kind == 'tracked' else '', 'product_id': 3 if kind == 'generic' else 4, 'warehouse_id': 1, 'qty': qty, 'levels': {'1': 'A'}})
            assert result['codes'] == [code]
        native = lambda: json.loads(native_path.read_text())
        search_products = request()['products']
        assert search_products['4']['tags'] == ['Hydraulics', 'Service parts']
        assert search_products['4']['extrafields']['material'] == {'label': 'Material', 'value': 'Stainless steel'}
        assert search_products['4']['extrafields']['zero']['value'] == '0'
        assert search_products['4']['extrafields']['description']['value'] == 'Heat resistant'
        assert search_products['4']['extrafields']['admin_only']['value'] == 'ADMIN-ALLOY'
        assert 'product_only' not in search_products['3']['extrafields']
        assert search_products['4']['extrafields']['product_only']['value'] == 'Product-specific'
        reader_products = request(role='reader')['products']
        assert 'admin_only' not in reader_products['4']['extrafields']
        assert request(role='no-tags')['products']['4']['tags'] == []
        assert request(role='disabled-category')['products']['4']['tags'] == []
        for secret in ['EXTRA_PASSWORD_SECRET', 'EXTRA_HIDDEN_SECRET', 'EXTRA_DISABLED_SECRET', 'EXTRA_HIDDEN_ATTRIBUTE_SECRET', 'EXTRA_UNKNOWN_SECRET', 'FOREIGN_TAG_SECRET']:
            assert secret not in json.dumps(search_products)
        def native_entries(kind, identifier, role='admin', expected=200, **params):
            url = base + 'native.php?' + urlencode({'kind': kind, 'id': identifier, 'role': role, **params})
            try:
                with client.open(url) as response:
                    assert response.status == expected
                    assert response.headers['Cache-Control'] == 'no-store'
                    return response.read().decode()
            except HTTPError as error:
                assert error.code == expected, error.read().decode()
                return ''
        product_entries = native_entries('product', 4)
        for role, allowed in [('admin', True), ('reader', True), ('no-stock', False), ('external-admin', False), ('inactive', False), ('disabled-binloc', False)]:
            with client.open(base + 'descriptor_fixture.php?role=' + role) as response:
                descriptor = json.load(response)
                assert descriptor['allowed'] is allowed
                assert 'productlotcard' in descriptor['parts']['hooks']['data']
                assert [tab['data'].split(':', 1)[0] for tab in descriptor['tabs']] == ['product', 'stock', 'productlot']
        assert '#/items/' + tracked in product_entries and '#/items/' + box in product_entries
        assert '#/items/' + generic not in product_entries
        assert 'data-native-tabs' in product_entries and 'tab_product_locations.php?id=4' in product_entries
        assert '#/items/' + generic in native_entries('product', 3)
        assert '#/items/' + tracked in native_entries('lot', 1)
        assert '#/items/' + box not in native_entries('lot', 1)
        assert '#/items/' + tracked in native_entries('warehouse', 1, bin_key='1:v' + 'a')
        assert 'No related QR entries.' in native_entries('warehouse', 2)
        native_entries('warehouse', 1, role='no-binloc', expected=403, bin_key='1:va')
        for role in ['no-stock', 'no-product', 'external', 'disabled']:
            native_entries('product', 4, role=role, expected=403)
        native_entries('product', 999, expected=403)
        native_entries('lot', 999, expected=403)
        native_entries('warehouse', 999, expected=403)
        native_entries('invalid', 4, expected=400)
        native_entries('salesorder', 39, role='restricted', expected=403)
        native_entries('user', 9, role='reader', expected=403)
        for context, kind, identifier in [('productcard', 'product', 4), ('warehousecard', 'warehouse', 1), ('productlotcard', 'lot', 1), ('ordercard', 'salesorder', 39)]:
            with client.open(base + 'hook_fixture.php?' + urlencode({'context': context + ':globalcard', 'id': identifier})) as response:
                assert 'native.php?kind=' + kind + '&amp;id=' + str(identifier) in response.read().decode()
        for context, role in [('productcard', 'external'), ('ordercard', 'restricted'), ('unknown', 'admin')]:
            with client.open(base + 'hook_fixture.php?' + urlencode({'context': context, 'id': 4 if context == 'productcard' else 39, 'role': role})) as response:
                assert response.read().decode() == ''
        offline = native(); original_url = offline['constants']['1']['QRR_SERVICE_URL']
        try:
            offline['constants']['1']['QRR_SERVICE_URL'] = 'http://127.0.0.1:1'
            native_path.write_text(json.dumps(offline))
            with client.open(base + 'hook_fixture.php?context=productcard&id=4') as response:
                assert 'native.php?kind=product' in response.read().decode()
            native_entries('product', 4, expected=503)
        finally:
            restored = native(); restored['constants']['1']['QRR_SERVICE_URL'] = original_url
            native_path.write_text(json.dumps(restored))
        assert native()['stock']['4']['1'] == 30

        def workflow(kind, code, **fields):
            result = request(action='workflow', payload={'kind': kind, 'codes': [code], **fields})
            assert result[0]['ok'], result
            return result

        workflow('move', tracked, warehouse_id=2, patch={'qty': 999}, effects=[{'delta': 999}])
        assert native()['stock']['4']['1'] == 29 and native()['stock']['4']['2'] == 5
        workflow('consume', box, quantities={box: 3}, post_stock=True, reference_type='production', reference_id=19)
        references = request()['consumption_references']
        assert '#/items/' + box in native_entries('production', 19)
        native_entries('production', 19, role='reader', expected=403)
        assert references['production:19']['ref'] == 'MO-0019'
        assert references['production:19']['url'].endswith('/mrp/mo_card.php?id=19')
        assert 'production:19' not in request(role='reader')['consumption_references']
        workflow('return', box, quantities={box: 2}, post_stock=True, warehouse_id=1)
        workflow('correct', box, quantities={box: 5})
        workflow('checkout', generic, person_id=9)
        assert '#/items/' + generic in native_entries('user', 9)
        reader_view = request(role='reader')
        assert reader_view['state']['items'][generic]['checkout'] == {}
        assert '9' not in reader_view['users'] and '9' not in reader_view['state']['personal_warehouses']
        assert 'Taylor' not in json.dumps(reader_view['users'])
        workflow('checkin', generic)
        state = request()['state']
        assert state['items'][box]['qty'] == 5 and state['items'][box]['consumed_units'] == 1
        assert not any(item.get('pending_operation') or item.get('pending_handoff') for item in state['items'].values())
        reader_attempt = request(action='workflow', role='manager', payload={'kind': 'consume', 'codes': [box], 'post_stock': True, 'quantities': {box: 1}})
        assert not reader_attempt[0]['ok'] and request()['state']['items'][box]['qty'] == 5
        before = request()['state']['revision']
        request(action='mapping', role='manager', payload={'user_id': 9, 'warehouse_id': 2}, expected=403)
        assert request()['state']['revision'] == before
        # Authorization is enforced by direct HTTP requests, independently of Angular controls.
        for role in ['no-qr', 'no-product', 'no-stock', 'external', 'external-admin', 'inactive', 'anonymous', 'disabled', 'disabled-stock', 'disabled-product', 'disabled-binloc', 'disabled-productbatch']:
            request(role=role, expected=403)
            request('products', role=role, expected=403)
            for endpoint in ['index.php', 'label.php', 'batch_print.php', 'bin_print.php', 'qr.php', 'thumbnail.php']:
                url = base + endpoint + '?' + urlencode({'role': role, 'code': tracked, 'batch': batch, 'warehouse_id': 1})
                try:
                    with client.open(url) as response:
                        assert response.status == 403, (endpoint, role, response.status)
                except HTTPError as error:
                    assert error.code == 403, (endpoint, role, error.code)
        operator = request(role='operator')
        assert not operator['permissions']['orders'] and not any(operator['permissions']['references'].values())
        assert set(operator['users']) <= {'8'}
        request('orders', role='operator', expected=403)
        request('references', role='operator', params={'type': 'production'}, expected=403)
        request('picking', role='operator', params={'warehouse_id': 1, 'order_id': 39}, expected=403)
        request(action='workflow', role='operator', payload={'kind': 'consume', 'codes': [generic], 'reference_type': 'salesorder', 'reference_id': 39}, expected=403)
        assert request('orders', role='restricted') == []
        assert request('references', role='restricted', params={'type': 'salesorder'}) == []
        request('picking', role='restricted', params={'warehouse_id': 1, 'order_id': 39}, expected=403)
        request(action='workflow', role='restricted', payload={'kind': 'consume', 'codes': [generic], 'reference_type': 'salesorder', 'reference_id': 39}, expected=403)
        hidden_locations = request(role='no-binloc')
        assert not hidden_locations['permissions']['locations']
        assert not hidden_locations['state']['binloc_label_settings']
        assert all(not item['bin'] and not item['bin_key'] and not item['bin_values'] for item in hidden_locations['state']['items'].values())
        request('levels', role='no-binloc', params={'warehouse_id': 1}, expected=403)
        request('locations', role='no-binloc', params={'warehouse_id': 1}, expected=403)
        reader_history = request(role='reader')['state']['items'][box]['consumption_log']
        assert all('reference_id' not in entry and 'reference_type' not in entry for entry in reader_history)
        assert request()['state']['history'] == []
        # Synthetic secrets and pending-operation internals must never survive browser projection.
        state_file = data / 'qrrouter/entity-1/state.sqlite3'
        original_state = read_state(state_file)
        secret = 'PRIVATE-AUDIT-PATCH-DO-NOT-SERVE'
        seeded = json.loads(json.dumps(original_state))
        seeded['server_only'] = secret
        seeded['items'][generic]['server_only'] = secret
        seeded['items'][tracked]['server_only'] = secret
        seeded['items'][generic]['pending_operation'] = {'id': 'test-pending', 'kind': 'move', 'at': '2026-01-01T00:00:00Z', 'patch': {'reason': secret}, 'effects': [{'price': secret}]}
        seeded['history'].append({'context': {'secret': secret}})
        try:
            write_state(state_file, seeded)
            for role in ['admin', 'reader', 'operator']:
                view = request(role=role)
                assert secret not in json.dumps(view)
                assert set(view['state']['items'][generic]['pending_operation']) == {'id', 'kind', 'at'}
                assert secret not in json.dumps(request('locations', role=role, params={'warehouse_id': 2}))
            foreign = native(); foreign['product_entities'] = {'4': 2}; native_path.write_text(json.dumps(foreign))
            scoped = request()
            native_entries('product', 4, expected=403)
            assert '#/items/' + tracked not in native_entries('warehouse', 2)
            assert tracked not in scoped['state']['items'] and box not in scoped['state']['items']
            assert '4' not in scoped['products']
            assert all(tracked not in row['codes'] and box not in row['codes'] for row in scoped['state']['batches'].values())
            assert all(row.get('code') not in [tracked, box] for row in request('picking', params={'warehouse_id': 2, 'order_id': 39}))
            assert not request('locations', params={'warehouse_id': 2})['summary']['tracked']
            for endpoint in ['label.php', 'qr.php', 'thumbnail.php']:
                try:
                    client.open(base + endpoint + '?' + urlencode({'code': tracked}))
                    raise AssertionError('Foreign product served by ' + endpoint)
                except HTTPError as error:
                    assert error.code == 404
            request(action='count', payload={'code': box, 'quantity': 5}, expected=403)
        finally:
            write_state(state_file, original_state)
            restored = native(); restored.pop('product_entities', None); native_path.write_text(json.dumps(restored))
        assert request()['state']['revision'] == before
        print('Authorization PASS: native read rights, external/disabled users, object scopes, restricted references, employee privacy, field projection and direct media access.', flush=True)
        print('Native references PASS: product/warehouse/lot tabs, card hooks, Binloc filtering, employee loans, transaction history and authorization.', flush=True)
        request(action='register', payload={'type': 'generic', 'codes': [blank], 'label': 'Unsafe', 'product_id': 999, 'warehouse_id': 1}, expected=409)
        assert request()['state']['items'][blank]['type'] == 'unassigned'
        with client.open(base + 'index.php') as response:
            host = response.read().decode()
            assert 'qrr-root' in host and '/spa/main-' in host and key not in host
        assert request()['state']['revision'] == before
        with client.open(base + 'api.php?resource=products&q=Part') as response:
            assert json.load(response)[0]['id'] == 3
        with client.open(base + 'api.php?resource=picking&warehouse_id=1&order_id=39') as response:
            assert isinstance(json.load(response), list)
        assert len(native()['movements']) == 9
        # Creating stock uses user names, native lots and Binloc, with independent QR IDs.
        new_box = request(action='create', payload={'type': 'box', 'label': 'BOX-NEW', 'product_id': 4, 'warehouse_id': 1, 'qty': 8, 'levels': {'1': 'B'}})
        new_serial = request(action='create', payload={'type': 'tracked', 'label': 'Named tool', 'serial': 'USER-SERIAL-01', 'native_batch': 'FORGED', 'product_lot_id': 9999, 'product_id': 4, 'warehouse_id': 1, 'levels': {'1': 'C'}})
        inventory = request()['state']['items']
        box_lot = str(inventory[new_box]['product_lot_id'])
        serial_lot = str(inventory[new_serial]['product_lot_id'])
        assert native()['lots'][box_lot]['batch'] == 'BOX-NEW' and new_box != 'BOX-NEW'
        assert native()['lots'][serial_lot]['batch'] == 'USER-SERIAL-01' and new_serial != 'USER-SERIAL-01'
        assert native()['locations'][box_lot]['values']['1']['value'] == 'B'
        assert native()['locations'][serial_lot]['values']['1']['value'] == 'C'
        request(action='create', payload={'type': 'tracked', 'label': 'Duplicate', 'serial': 'USER-SERIAL-01', 'product_id': 4, 'warehouse_id': 1}, expected=409)
        assert not request()['state'].get('pending_native')
        workflow('move', new_serial, warehouse_id=1, levels={'1': 'D'})
        assert request()['state']['items'][new_serial]['bin_values'] == {'1': 'D'}
        # Native edits are visible after refresh, and subsequent correction uses the native quantity.
        changed = native()
        changed['batches']['4']['1']['BOX-NEW'] = 6
        changed['stock']['4']['1'] -= 2
        changed['locations'][box_lot]['values']['1']['value'] = 'E'
        changed['locations'][box_lot]['values']['1']['display'] = 'E'
        native_path.write_text(json.dumps(changed))
        assert request()['state']['items'][new_box]['qty'] == 6
        assert request()['state']['items'][new_box]['bin'] == 'E'
        with client.open(base + 'api.php?resource=locations&warehouse_id=1') as response:
            assert 'E' in json.load(response)['bins']
        workflow('correct', new_box, quantities={new_box: 7})
        assert native()['batches']['4']['1']['BOX-NEW'] == 7
        total_before = native()['stock']['4']['1']
        request(action='box-transfer', payload={'from': new_box, 'to': box, 'quantity': 2})
        assert native()['batches']['4']['1']['BOX-NEW'] == 5 and native()['batches']['4']['1']['Fixture box'] == 7
        assert native()['stock']['4']['1'] == total_before
        workflow('checkout', new_serial, person_id=9)
        workflow('checkin', new_serial)
        assert request()['state']['items'][new_serial]['bin_values'] == {'1': 'D'}
        # Binloc failure rolls back lot creation and stock, retaining durable recovery intent.
        changed = native(); changed['fail_location'] = True; native_path.write_text(json.dumps(changed))
        count_before = len(native()['lots']); stock_before = native()['stock']['4']['1']
        request(action='create', payload={'type': 'box', 'label': 'RECOVER-BOX', 'product_id': 4, 'warehouse_id': 1, 'qty': 3}, expected=409)
        assert len(native()['lots']) == count_before and native()['stock']['4']['1'] == stock_before
        pending_path = data / 'qrrouter/entity-1/state.sqlite3'
        def assert_hidden_recovery():
            saved_native = native_path.read_bytes()
            saved_pending = read_state(pending_path)
            try:
                hidden = native(); hidden['product_entities'] = {'4': 2}; native_path.write_text(json.dumps(hidden))
                hidden_native = native_path.read_bytes()
                for action in ['native-recover', 'native-cancel']:
                    request(action=action, payload={}, expected=403)
                    assert read_state(pending_path) == saved_pending
                    assert native_path.read_bytes() == hidden_native
            finally:
                native_path.write_bytes(saved_native)
        pending_state = read_state(pending_path); pending_state['pending_native']['at'] = '2020-01-01T00:00:00Z'; write_state(pending_path, pending_state)
        changed = native(); changed.pop('fail_location'); native_path.write_text(json.dumps(changed))
        assert_hidden_recovery()
        recovered = request(action='native-recover', payload={})
        assert request()['state']['items'][recovered]['qty'] == 3 and not request()['state'].get('pending_native')
        assert native()['stock']['4']['1'] == stock_before + 3
        # Lost service-finalization response: the same committed receipt finishes without reapplying stock.
        write_state(pending_path, pending_state)
        assert_hidden_recovery()
        lots_after = len(native()['lots']); movements_after = len(native()['movements'])
        assert request(action='native-recover', payload={}) == recovered
        assert len(native()['lots']) == lots_after and len(native()['movements']) == movements_after
        assert native()['stock']['4']['1'] == stock_before + 3
        changed = native(); changed['fail_location'] = True; native_path.write_text(json.dumps(changed))
        request(action='create', payload={'type': 'box', 'label': 'CANCEL-BOX', 'product_id': 4, 'warehouse_id': 1, 'qty': 3}, expected=409)
        pending_state = read_state(pending_path); pending_state['pending_native']['at'] = '2020-01-01T00:00:00Z'; write_state(pending_path, pending_state)
        request(action='native-cancel', payload={})
        assert not request()['state'].get('pending_native')
        assert native()['stock']['4']['1'] == stock_before + 3
        changed = native(); changed.pop('fail_location'); native_path.write_text(json.dumps(changed))
        generated_serials = []
        for index in range(2):
            generated_code = request(action='create', payload={'type': 'tracked', 'label': 'Automatic serial', 'product_id': 4, 'warehouse_id': 1, 'levels': {'1': 'F'}})
            generated_item = request()['state']['items'][generated_code]
            generated_serials.append(generated_item['serial'])
            assert generated_item['serial'].startswith('PART-003-AUTOMATIC-SERIAL-') and len(generated_item['serial']) <= 100
            assert generated_item['native_batch'] == generated_item['serial'] != generated_code
            assert native()['lots'][str(generated_item['product_lot_id'])]['batch'] == generated_item['serial']
            assert native()['locations'][str(generated_item['product_lot_id'])]['values']['1']['value'] == 'F'
        assert len(set(generated_serials)) == 2
        # Existing unassociated serials attach without receiving stock, including empty lots.
        for qty in [0, 1]:
            changed = native()
            lot_id = max(map(int, changed['lots'])) + 1
            serial = 'UNLINKED-SERIAL-' + str(qty)
            changed['lots'][str(lot_id)] = {'fk_product': 4, 'batch': serial, 'entity': 1}
            changed['batches']['4']['1'][serial] = qty
            changed['stock']['4']['1'] += qty
            native_path.write_text(json.dumps(changed))
            stock_before_link = native()['stock']['4']['1']
            movements_before_link = len(native()['movements'])
            linked_code = request(action='create', payload={'type': 'tracked', 'label': 'Link existing', 'serial': serial, 'product_id': 4, 'warehouse_id': 1})
            linked_item = request()['state']['items'][linked_code]
            assert linked_item['product_lot_id'] == lot_id and linked_item['qty'] == qty
            assert native()['stock']['4']['1'] == stock_before_link
            assert len(native()['movements']) == movements_before_link
            request(action='create', payload={'type': 'tracked', 'label': 'Duplicate link', 'serial': serial, 'product_id': 4, 'warehouse_id': 1}, expected=409)
            assert not request()['state'].get('pending_native')
        request(action='update', payload={'code': generated_code, 'type': 'tracked', 'label': 'Updated name', 'product_id': 4, 'warehouse_id': 1, 'levels': {'1': 'F'}})
        assert request()['state']['items'][generated_code]['serial'] == generated_serials[-1]
        request(action='register', payload={'type': 'tracked', 'codes': [blank], 'label': 'Generated registration', 'product_id': 4, 'warehouse_id': 1})
        registered_auto = request()['state']['items'][blank]
        assert registered_auto['serial'].startswith('PART-003-GENERATED-REGISTRATION-')
        assert registered_auto['product_lot_id'] > 0 and registered_auto['qty'] == 1
        # Assigned serial batches stage all identities and receive one unit per label atomically.
        bulk_fields = {'type': 'tracked', 'label': 'Bulk native', 'product_id': 4, 'warehouse_id': 1, 'levels': {'1': 'BULK'}, 'count': 3}
        for use_labels in [False, True]:
            supplied = ['Exact serial A', 'Exact serial B', 'Exact serial C']
            payload = dict(bulk_fields, label_as_serial=use_labels, labels=supplied)
            stock_before_bulk = native()['stock']['4']['1']
            batch_id = request(action='bulk', payload=payload)
            state = request()['state']
            bulk_codes = state['batches'][batch_id]['codes']
            assert len(bulk_codes) == len(set(bulk_codes)) == 3
            serials = [state['items'][code]['serial'] for code in bulk_codes]
            assert len(set(serials)) == 3
            assert native()['stock']['4']['1'] == stock_before_bulk + 3
            for index, code in enumerate(bulk_codes):
                item = state['items'][code]
                assert native()['lots'][str(item['product_lot_id'])]['batch'] == item['serial']
                assert item['qty'] == 1 and item['bin_values'] == {'1': 'BULK'}
                if use_labels:
                    assert item['serial'] == item['label'] == supplied[index]
                else:
                    assert item['label'] == supplied[index] and item['serial'] != supplied[index]
            if use_labels:
                before_duplicate = native_path.read_bytes()
                request(action='bulk', payload=payload, expected=400)
                assert native_path.read_bytes() == before_duplicate
                assert not request()['state'].get('pending_native')
        # Reject malformed lists before staging or writing native stock.
        before_malformed = native_path.read_bytes()
        for labels in [{'wrong': 'name'}, [['nested'], 'B', 'C'], [None, 'B', 'C'], [' ', 'B', 'C'], []]:
            request(action='bulk', payload=dict(bulk_fields, labels=labels), expected=400)
            assert native_path.read_bytes() == before_malformed
            assert not request()['state'].get('pending_native')
        duplicate_payload = dict(bulk_fields, count=2, label_as_serial=True, labels=['DUPLICATE', 'duplicate'])
        native_before = native_path.read_bytes()
        request(action='bulk', payload=duplicate_payload, expected=400)
        assert native_path.read_bytes() == native_before and not request()['state'].get('pending_native')
        exact_code = request(action='create', payload={'type': 'tracked', 'label': 'Exact single label', 'label_as_serial': True, 'product_id': 4, 'warehouse_id': 1})
        assert request()['state']['items'][exact_code]['serial'] == 'Exact single label'
        box_payload = {'type': 'box', 'labels': ['Bulk box east', 'Bulk box west'], 'count': 2, 'qty': 5, 'product_id': 4, 'warehouse_id': 1, 'levels': {'1': 'BOXES'}}
        stock_before_boxes = native()['stock']['4']['1']
        box_batch = request(action='bulk', payload=box_payload)
        box_state = request()['state']
        for index, code in enumerate(box_state['batches'][box_batch]['codes']):
            item = box_state['items'][code]
            assert item['native_batch'] == item['label'] == box_payload['labels'][index]
            assert item['serial'] == '' and item['qty'] == 5 and item['bin_values'] == {'1': 'BOXES'}
            assert native()['lots'][str(item['product_lot_id'])]['batch'] == item['label']
        assert native()['stock']['4']['1'] == stock_before_boxes + 10
        request(action='bulk', payload=box_payload, expected=400)
        assert native()['stock']['4']['1'] == stock_before_boxes + 10 and not request()['state'].get('pending_native')
        before_text_limits = native_path.read_bytes()
        for payload in [
            {'type': 'generic', 'label': 'x' * 141, 'count': 1, 'product_id': 4, 'warehouse_id': 1},
            {'type': 'tracked', 'label': 'Prefix', 'serial': 'x' * 101, 'count': 1, 'product_id': 4, 'warehouse_id': 1},
            {'type': 'tracked', 'labels': ['é' * 71], 'count': 1, 'product_id': 4, 'warehouse_id': 1},
            {'type': 'tracked', 'labels': ['é' * 51], 'label_as_serial': True, 'count': 1, 'product_id': 4, 'warehouse_id': 1},
            {'type': 'box', 'labels': ['é' * 51], 'qty': 1, 'count': 1, 'product_id': 4, 'warehouse_id': 1},
        ]:
            request(action='bulk', payload=payload, expected=400)
            assert native_path.read_bytes() == before_text_limits and not request()['state'].get('pending_native')
        print('Native integration PASS: bulk assigned serials, exact label serials, automatic and named serials, box lots, Binloc writes, live native observations, lot transfers, handoffs, transactional rollback and durable recovery.', flush=True)
        print('Gateway integration PASS: native workflows, real C# state, CSRF, permissions, trusted facts, product/order lookups, Angular hosting and no API-key exposure.', flush=True)
        if args.browser:
            env = dict(os.environ, QRR_E2E_URL=base, QRR_E2E_ITEM=tracked, QRR_E2E_BOX=box)
            subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'e2e'], cwd=root / 'frontend', env=env, check=True)
    except Exception:
        service_log.flush()
        php_log.flush()
        print((tmp / 'php.log').read_text(encoding='utf-8', errors='replace')[-5000:])
        raise
    finally:
        if php_server:
            php_server.terminate()
            with contextlib.suppress(Exception):
                php_server.wait(timeout=5)
        service.terminate()
        with contextlib.suppress(Exception):
            service.wait(timeout=10)
        service_log.close()
        php_log.close()
