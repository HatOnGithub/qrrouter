"""Exercise the real ASP.NET host, transport/auth contracts, persistence, and restart."""
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
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parents[1]
dll = root / 'src/QrRouterApi/bin/Release/net10.0/QrRouterApi.dll'
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
base = f'http://127.0.0.1:{port}'
key = secrets.token_hex(32)
headers = {'X-Api-Key': key, 'X-Qrr-Entity': '1', 'X-Qrr-User': '7', 'X-Qrr-Read': '1',
           'X-Qrr-Manage': '1', 'X-Qrr-Admin': '1', 'X-Qrr-Stock': '1', 'Content-Type': 'application/json'}
passed = 0


def request(path, data=None, override=None, expected=200):
    global passed
    req = Request(base + path, headers=headers if override is None else override,
                  data=None if data is None else json.dumps(data).encode())
    try:
        with urlopen(req, timeout=10) as response:
            status, body = response.status, json.load(response)
    except HTTPError as error:
        status = error.code
        raw = error.read()
        body = json.loads(raw) if raw else None
    assert status == expected, (path, status, expected, body)
    passed += 1
    return body


def start(env, log, application=dll, working_directory=root):
    process = subprocess.Popen(['dotnet', str(application)], cwd=working_directory, env=env, stdout=log, stderr=log)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Service exited unexpectedly')
        try:
            request('/health', override={})
            return process
        except (URLError, ConnectionError):
            time.sleep(0.1)
    process.terminate()
    raise TimeoutError('Service did not start')


with tempfile.TemporaryDirectory(prefix='qrrouter-http-') as directory:
    config = Path(directory) / 'service.json'
    data_directory = Path(directory) / 'data'
    config.write_text(json.dumps({'AppSettings': {'ApiKey': key, 'DataDirectory': str(data_directory)}}), encoding='utf-8')
    env = dict(os.environ, QRR_CONFIG_FILE=str(config), ASPNETCORE_URLS=base, ASPNETCORE_ENVIRONMENT='Production')
    env.pop('AppSettings__ApiKey', None)
    env.pop('AppSettings__DataDirectory', None)
    with open(Path(directory) / 'host.log', 'w', encoding='utf-8') as log:
        process = start(env, log)
        try:
            request('/api/inventory', override={}, expected=401)
            request('/api/inventory', override=dict(headers, **{'X-Api-Key': 'wrong'}), expected=401)
            request('/api/inventory', override=dict(headers, **{'X-Qrr-Entity': '0'}), expected=400)
            state = request('/api/inventory')
            assert state['schema'] == 2 and state['items'] == {}
            batch = request('/api/inventory/bulk', {'count': 2})['result']
            state = request('/api/inventory')
            assert len(state['batches'][batch]['codes']) == 2
            assert state['history'] == []
            assert len(request('/api/inventory?includeHistory=true')['history']) == 1
            readonly = dict(headers, **{'X-Qrr-Manage': '0', 'X-Qrr-Admin': '0', 'X-Qrr-Stock': '0'})
            request('/api/inventory/bulk', {'count': 1}, override=readonly, expected=403)
            request('/api/inventory/query-batches', {}, override=readonly)
            request('/api/inventory', override=dict(headers, **{'X-Qrr-Entity': '2'}))
            request('/api/inventory/unknown', {}, expected=400)
            # Match PHP cURL serialization: numeric ID maps are JSON objects.
            code = state['batches'][batch]['codes'][0]
            request('/api/inventory/register', {'codes': [code], 'type': 'box', 'label': 'Parts', 'product_id': 4,
                    'warehouse_id': 1, 'qty': 5, 'choice': {'bin': 'A1', 'bin_key': '1:2', 'bin_values': []},
                    'warehouses': {'1': {'ref': 'MAIN'}, '2': {'ref': 'OTHER'}}})
            data = {'code': code, 'kind': 'consume', 'args': {'quantity': 2, 'post_stock': True},
                    'warehouses': {'1': {'ref': 'MAIN'}}}
            data['revision'] = request('/api/inventory/plan', data)['result']['revision']
            op = request('/api/inventory/stage', data)['result']
            process.terminate()
            process.wait(timeout=15)
            # Replace the application directory and working directory, retaining external configuration and data.
            upgraded = Path(directory) / 'release-2'
            shutil.copytree(dll.parent, upgraded)
            process = start(env, log, application=upgraded / dll.name, working_directory=upgraded)
            restored = request('/api/inventory')
            assert restored['batches'][batch] == state['batches'][batch]
            assert len(restored['items']) == 2
            recovered = request('/api/inventory')['items'][code]
            assert recovered['qty'] == 5 and recovered['pending_operation']['id'] == op['id']
            request('/api/inventory/finish', {'code': code, 'id': op['id'], 'proof': {'seen': [1], 'other': 0}})
            assert request('/api/inventory')['items'][code]['qty'] == 3
            print(f'Passed {passed} HTTP checks, including application-directory replacement with external configuration, batches and a pending stock operation.')
        finally:
            process.terminate()
            process.wait(timeout=15)


    # Misconfigured or missing storage must fail before silently creating a fresh local inventory.
    for settings in [
        {'AppSettings__DataDirectory': 'data'},
        {'AppSettings__DataDirectory': str(dll.parent / 'data')},
        {'QRR_CONFIG_FILE': str(Path(directory) / 'missing.json')},
        {'QRR_CONFIG_FILE': 'relative-config.json'},
    ]:
        invalid = dict(env, **settings)
        snapshot = (data_directory / 'entity-1/state.sqlite3').read_bytes()
        with open(Path(directory) / 'rejected-startup.log', 'w', encoding='utf-8') as log:
            rejected = subprocess.Popen(['dotnet', str(dll)], cwd=root, env=invalid, stdout=log, stderr=log)
            try:
                try:
                    assert rejected.wait(timeout=30) != 0, 'Invalid persistent storage configuration accepted'
                except subprocess.TimeoutExpired as error:
                    details = (Path(directory) / 'rejected-startup.log').read_text(encoding='utf-8', errors='replace')
                    raise AssertionError(f'Startup did not reject {settings}: {details}') from error
            finally:
                if rejected.poll() is None:
                    rejected.terminate()
                    rejected.wait(timeout=10)
        assert (data_directory / 'entity-1/state.sqlite3').read_bytes() == snapshot
    print('Storage validation PASS: unsafe paths and missing external settings reject startup without changing saved inventory.')
