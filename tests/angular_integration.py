"""Test Angular's PHP gateway with a real C# service and mock Dolibarr native APIs.

Use --browser to also run Playwright against the built, PHP-hosted Angular application.
"""
import argparse
import ast
import contextlib
import http.cookiejar
import hashlib
import importlib.util
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
import native_fixture as native_contract
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import build_opener, HTTPCookieProcessor, urlopen

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
spec = importlib.util.spec_from_file_location('native_fixture', root / 'reference/module-2.6.14/qrrouter/tests/test_http_inventory.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


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
        except (URLError, ConnectionError):
            time.sleep(.1)
    raise TimeoutError('Fixture server did not start')


with tempfile.TemporaryDirectory(prefix='qrrouter-angular-') as directory:
    tmp = Path(directory)
    webroot = tmp / 'htdocs'
    data = tmp / 'data'
    data.mkdir()
    shutil.copytree(root / 'dolibarr/qrrouter', webroot / 'custom/qrrouter')
    for folder in ['product/class', 'product/stock/class', 'custom/binloc/class', 'custom/binloc/lib', 'commande/class', 'core/lib']:
        (webroot / folder).mkdir(parents=True, exist_ok=True)
    main = fixture.MAIN.replace("if(str_contains($sql,'FROM llx_entrepot')){", "if(str_contains($sql,'FROM llx_product WHERE')){$this->rows=[(object)['rowid'=>3,'ref'=>'PART-003','label'=>'Fixture Part']];}elseif(str_contains($sql,'FROM llx_entrepot')){")
    main = main.replace("elseif(str_contains($sql,'FROM llx_entrepot')){", 'else' + native_contract.QUERIES.lstrip())
    main = main.replace("'label'=>'Fixture Part']];", "'label'=>'Fixture Part'],(object)['rowid'=>4,'ref'=>'SERIAL-004','label'=>'Tracked Part']];")
    main = main.replace('$this->idx=0;$s=$this->state();', '$this->idx=0;$s=$this->txn??$this->state();')
    main = main.replace('<meta charset="utf-8">', '<meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:rgb(40,40,40);background:rgb(250,250,250)}.butAction{background:rgb(83,101,117);color:white;border:1px solid gray;border-radius:3px}.flat{background:white;color:rgb(40,40,40)}</style>')
    main = main.replace('function llxHeader($a,$title){print ', 'function llxHeader($a,$title){global $conf; print ')
    main = main.replace("</head><body><main data-title=", "</head><body>'.(empty($conf->dol_hide_leftmenu)?'<aside id=\"id-left\">Native left menu</aside>':'').'<main data-title=")
    main = main.replace("elseif(str_contains($sql,'FROM llx_user')){", "elseif(str_contains($sql,'FROM llx_user')){ if (!empty($s['users_empty'])) return true;")
    main = main.replace("$GLOBALS['db']=new FakeDB();", """
$GLOBALS['db']=new FakeDB();
$GLOBALS['conf']->entity = max(1, (int) ($_GET['entity'] ?? 1));
$GLOBALS['conf']->global = (object) ($GLOBALS['db']->state()['constants'][(string) $GLOBALS['conf']->entity] ?? []);
""")
    locale_source = ast.parse((root / 'reference/module-2.6.14/qrrouter/tests/test_http_locales.py').read_text(encoding='utf-8'))
    locale_fixture = next(ast.literal_eval(node.value) for node in locale_source.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'LANGS' for target in node.targets))
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
 public $id=8,$admin; private $role;
 public function __construct($role){$this->role=$role;$this->admin=$role==='admin'?1:0;}
 public function hasRight(...$a){if($this->admin)return true;if($a===['produit','lire']||$a===['qrrouter','read']||$a===['commande','lire'])return true;return $this->role==='manager'&&$a===['qrrouter','manage'];}
};
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
    product = product.replace('public function hasbatch(){return false;}', 'public function hasbatch(){return $this->id===4;}'+native_contract.PRODUCT_METHOD)
    for target, content in {'main.inc.php': main, 'product/class/product.class.php': product,
                            'product/stock/class/entrepot.class.php': fixture.WAREHOUSE,
                            'product/stock/class/productlot.class.php': native_contract.LOT,
                            'custom/binloc/class/binlocwarehouselevel.class.php': native_contract.LEVELS,
                            'custom/binloc/class/binlocproductlocation.class.php': native_contract.LOCATION,
                            'custom/binloc/lib/binloc.lib.php': native_contract.LIBRARY,
                            'commande/class/commande.class.php': commande,
                            'native.php': "<?php require __DIR__.'/main.inc.php'; llxHeader('', 'Native Dolibarr page'); llxFooter();",
                            'core/lib/admin.lib.php': admin}.items():
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

        def request(resource='bootstrap', action=None, payload=None, role='admin', csrf=None, expected=200):
            global_params = {'role': role, 'action': action} if action else {'role': role, 'resource': resource}
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
        assert native()['stock']['4']['1'] == 30

        def workflow(kind, code, **fields):
            result = request(action='workflow', payload={'kind': kind, 'codes': [code], **fields})
            assert result[0]['ok'], result
            return result

        workflow('move', tracked, warehouse_id=2, patch={'qty': 999}, effects=[{'delta': 999}])
        assert native()['stock']['4']['1'] == 29 and native()['stock']['4']['2'] == 5
        workflow('consume', box, quantities={box: 3}, post_stock=True, reference_type='production', reference_id=19)
        workflow('return', box, quantities={box: 2}, post_stock=True, warehouse_id=1)
        workflow('correct', box, quantities={box: 5})
        workflow('checkout', generic, person_id=9)
        workflow('checkin', generic)
        state = request()['state']
        assert state['items'][box]['qty'] == 5 and state['items'][box]['consumed_units'] == 1
        assert not any(item.get('pending_operation') or item.get('pending_handoff') for item in state['items'].values())
        reader_attempt = request(action='workflow', role='manager', payload={'kind': 'consume', 'codes': [box], 'post_stock': True, 'quantities': {box: 1}})
        assert not reader_attempt[0]['ok'] and request()['state']['items'][box]['qty'] == 5
        before = request()['state']['revision']
        request(action='mapping', role='manager', payload={'user_id': 9, 'warehouse_id': 2}, expected=403)
        assert request()['state']['revision'] == before
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
        pending_path = data / 'qrrouter/entity-1/state.json'
        pending_state = json.loads(pending_path.read_text()); pending_state['pending_native']['at'] = '2020-01-01T00:00:00Z'; pending_path.write_text(json.dumps(pending_state))
        changed = native(); changed.pop('fail_location'); native_path.write_text(json.dumps(changed))
        recovered = request(action='native-recover', payload={})
        assert request()['state']['items'][recovered]['qty'] == 3 and not request()['state'].get('pending_native')
        assert native()['stock']['4']['1'] == stock_before + 3
        # Lost service-finalization response: the same committed receipt finishes without reapplying stock.
        pending_path.write_text(json.dumps(pending_state))
        lots_after = len(native()['lots']); movements_after = len(native()['movements'])
        assert request(action='native-recover', payload={}) == recovered
        assert len(native()['lots']) == lots_after and len(native()['movements']) == movements_after
        assert native()['stock']['4']['1'] == stock_before + 3
        changed = native(); changed['fail_location'] = True; native_path.write_text(json.dumps(changed))
        request(action='create', payload={'type': 'box', 'label': 'CANCEL-BOX', 'product_id': 4, 'warehouse_id': 1, 'qty': 3}, expected=409)
        pending_state = json.loads(pending_path.read_text()); pending_state['pending_native']['at'] = '2020-01-01T00:00:00Z'; pending_path.write_text(json.dumps(pending_state))
        request(action='native-cancel', payload={})
        assert not request()['state'].get('pending_native')
        assert native()['stock']['4']['1'] == stock_before + 3
        changed = native(); changed.pop('fail_location'); native_path.write_text(json.dumps(changed))
        print('Native integration PASS: named serials, box lots, Binloc writes, live native observations, lot transfers, handoffs, transactional rollback and durable recovery.', flush=True)
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
