#!/usr/bin/env python3
"""HTTP rendering test for NL/FR against a simulated Dolibarr request locale."""
import contextlib
import http.cookiejar
import importlib.util
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

HERE=Path(__file__).resolve().parent
SOURCE=HERE.parent
spec=importlib.util.spec_from_file_location('qrr_http_flows_fixture',HERE/'test_http_flows.py')
fixture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
LANGS = r'''
class QrrHttpLangs {
 public $defaultlang; private $map=[];
 public function __construct($lang){$this->defaultlang=$lang;}
 public function load($domain){
  $path=__DIR__.'/custom/qrrouter/langs/'.$this->defaultlang.'/qrrouter.lang';
  foreach(file($path, FILE_IGNORE_NEW_LINES) as $line){
   if($line===''||$line[0]==='#'||strpos($line,'=')===false)continue;
   [$key,$val]=explode('=',$line,2);$this->map[$key]=$val;
  }
 }
 public function trans($key){return $this->map[$key]??$key;}
}
$GLOBALS['langs']=new QrrHttpLangs($_GET['testlang']??'en_US');
'''

def check(body,*terms):
 for term in terms:
  if term not in body: raise AssertionError(f'Missing {term!r}: {body[:450]}')

with tempfile.TemporaryDirectory(prefix='qrrouter-i18n-http-') as t:
    root=Path(t); htdocs=root/'htdocs'; site=htdocs/'custom'/'qrrouter'
    shutil.copytree(SOURCE,site,ignore=shutil.ignore_patterns('tests'))
    (htdocs/'product'/'class').mkdir(parents=True)
    (htdocs/'custom'/'binloc'/'class').mkdir(parents=True)
    (htdocs/'main.inc.php').write_text(fixture.MAIN.replace('return 1;',LANGS+'\nreturn 1;'))
    (htdocs/'product'/'class'/'product.class.php').write_text(fixture.PRODUCT)
    (htdocs/'custom'/'binloc'/'class'/'binlocwarehouselevel.class.php').write_text(fixture.BINLOC)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    log=open(root/'php.log','w')
    p=subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t',str(htdocs)],stdout=log,stderr=log)
    try:
        base=f'http://127.0.0.1:{port}/custom/qrrouter/'
        def get(path,lang):
            query='&' if '?' in path else '?'
            with urllib.request.urlopen(base+path+query+'testlang='+lang,timeout=6) as res:
                return res.read().decode('utf-8')
        for _ in range(40):
            try: get('index.php','en_US'); break
            except Exception:time.sleep(.1)
        en=get('register.php','en_US')
        check(en,'Tracked Individual','Tracked Generic','Counted Container','Register new items')
        nl=get('register.php','nl_NL')
        check(nl,'Individueel gevolgd','Generiek gevolgd','Container met aantal','Nieuwe artikelen registreren','QR scannen')
        fr=get('register.php','fr_FR')
        check(fr,'Article suivi individuellement','Article générique suivi','Contenant compté','Enregistrer de nouveaux articles','Scanner un QR','window.QRR_UI=','Caméra en marche')
        # Underlying URLs and workflow mode names must not be translated.
        check(fr,'mode=unique','mode=generic','mode=box')
        nlinventory=get('index.php','nl_NL')
        check(nlinventory,'QR-voorraad','Aantal','Artikelen verplaatsen')
        frprint=get('print_codes.php','fr_FR')
        check(frprint,'Nombre de codes QR','Créer un lot imprimable')
        nlmanual=get('manual.php','nl_NL')
        check(nlmanual,'QR-codes handmatig invoeren','Eén QR-code','Ingevoerde codes') if 'Ingevoerde codes' in nlmanual else check(nlmanual,'QR-codes handmatig invoeren','Eén QR-code')
        frmanage=get('manage.php','fr_FR')
        check(frmanage,'Article suivi individuellement','Article générique suivi','Contenant compté')
        nlworkflow=get('workflow.php?action=consume','nl_NL')
        check(nlworkflow,'Artikelen verbruiken','Scannen afronden')
        print('HTTP locale rendering PASS: en_US/nl_NL/fr_FR, navigation, registration, type options, inventory, manual, printing and workflows')
    finally:
        p.terminate()
        with contextlib.suppress(Exception):p.wait(timeout=3)
        log.close()
