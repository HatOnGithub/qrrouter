"""Test Angular's PHP gateway with a real C# service and mock Dolibarr native APIs.

Use --browser to also run Playwright against the built, PHP-hosted Angular application.
"""
import argparse
import ast
import contextlib
import http.cookiejar
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
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
    for folder in ['product/class', 'product/stock/class', 'custom/binloc/class', 'commande/class']:
        (webroot / folder).mkdir(parents=True, exist_ok=True)
    main = fixture.MAIN.replace("if(str_contains($sql,'FROM llx_entrepot')){", "if(str_contains($sql,'FROM llx_product WHERE')){$this->rows=[(object)['rowid'=>3,'ref'=>'PART-003','label'=>'Fixture Part']];}elseif(str_contains($sql,'FROM llx_entrepot')){")
    main = main.replace('<meta charset="utf-8">', '<meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:rgb(40,40,40);background:rgb(250,250,250)}.butAction{background:rgb(83,101,117);color:white;border:1px solid gray;border-radius:3px}.flat{background:white;color:rgb(40,40,40)}</style>')
    main = main.replace("elseif(str_contains($sql,'FROM llx_user')){", "elseif(str_contains($sql,'FROM llx_user')){ if (!empty($s['users_empty'])) return true;")
    locale_source = ast.parse((root / 'reference/module-2.6.14/qrrouter/tests/test_http_locales.py').read_text(encoding='utf-8'))
    locale_fixture = next(ast.literal_eval(node.value) for node in locale_source.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'LANGS' for target in node.targets))
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
    for target, content in {'main.inc.php': main, 'product/class/product.class.php': fixture.PRODUCT,
                            'product/stock/class/entrepot.class.php': fixture.WAREHOUSE,
                            'custom/binloc/class/binlocwarehouselevel.class.php': fixture.BINLOC,
                            'commande/class/commande.class.php': commande}.items():
        (webroot / target).write_text(content, encoding='utf-8')
    native_path = data / 'native.json'
    native_path.write_text(json.dumps({'warehouses': {'1': {'ref': 'MAIN', 'lieu': 'Main', 'status': 1}, '2': {'ref': 'OTHER', 'lieu': 'Other', 'status': 1}},
                                       'stock': {'3': {'1': 30, '2': 4}}, 'movements': [], 'users_empty': True}))
    api_base = f'http://127.0.0.1:{port()}'
    web_base = f'http://127.0.0.1:{port()}'
    key = secrets.token_hex(32)
    service_env = dict(os.environ, AppSettings__ApiKey=key, AppSettings__DataDirectory=str(data / 'qrrouter'), ASPNETCORE_URLS=api_base)
    php_env = dict(os.environ, QRR_SERVICE_URL=api_base, QRR_SERVICE_API_KEY=key)
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

        bootstrap = request()
        assert bootstrap['state']['schema'] == 2 and bootstrap['permissions']['admin']
        assert bootstrap['users'] == {} and bootstrap['state']['items'] == {}
        for locale, translated in [('nl_NL', 'Voorraad'), ('fr_FR', 'Stock')]:
            with client.open(base + 'api.php?resource=bootstrap&testlang=' + locale) as response:
                localized = json.load(response)
                assert localized['locale'] == locale and localized['translations']['Inventory'] == translated
        populated = json.loads(native_path.read_text())
        populated['users_empty'] = False
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
            result = request(action='register', payload={'type': kind, 'codes': [code], 'label': 'Fixture ' + kind, 'product_id': 3, 'warehouse_id': 1, 'qty': qty})
            assert result['codes'] == [code]
        native = lambda: json.loads(native_path.read_text())
        assert native()['stock']['3']['1'] == 30

        def workflow(kind, code, **fields):
            result = request(action='workflow', payload={'kind': kind, 'codes': [code], **fields})
            assert result[0]['ok'], result
            return result

        workflow('move', tracked, warehouse_id=2, patch={'qty': 999}, effects=[{'delta': 999}])
        assert native()['stock']['3']['1'] == 29 and native()['stock']['3']['2'] == 5
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
