#!/usr/bin/env python3
"""Self-contained HTTP registration smoke tests against mock Dolibarr 21 bootstrap.
Only writes to a temporary directory; never accesses a real Dolibarr instance.
"""
import contextlib
import http.cookiejar
import html
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SOURCE = Path(__file__).resolve().parents[1]
MAIN = r'''<?php
session_start();
define('DOL_DOCUMENT_ROOT', __DIR__);
define('DOL_DATA_ROOT', dirname(__DIR__).'/data');
define('MAIN_DB_PREFIX','llx_');
$GLOBALS['conf']=(object)['entity'=>1];
$GLOBALS['user']=new class{public $id=1,$admin=1; public function hasRight(...$args){return true;}};
class FakeDB {
 public $items=[],$idx=0;
 public function query($sql){$this->idx=0;$this->items=[];
  if(str_contains($sql,'FROM llx_entrepot'))$this->items=[(object)['rowid'=>1,'ref'=>'MAIN','lieu'=>'Main Warehouse']];
  elseif(str_contains($sql,'FROM llx_product_stock'))$this->items=[];
  elseif(str_contains($sql,'FROM llx_stock_mouvement'))$this->items=[];
  elseif(str_contains($sql,'FROM llx_mrp_mo'))$this->items=[(object)['rowid'=>19,'ref'=>'MO-0019']];
  elseif(str_contains($sql,'FROM llx_expedition'))$this->items=[(object)['rowid'=>29,'ref'=>'SHP-0029']];
  elseif(str_contains($sql,'FROM llx_commande c'))$this->items=[(object)['rowid'=>39,'ref'=>'SO-0039','customer'=>'Test Customer']];
  elseif(str_contains($sql,'FROM llx_commande'))$this->items=[(object)['rowid'=>39,'ref'=>'SO-0039']];
  else return false;
  return true;
 }
 public function fetch_object($res){return $this->items[$this->idx++]??false;}
 public function escape($value){return addslashes((string)$value);}
 public function free($res){}public function lasterror(){return 'fixture DB error';}
}
$GLOBALS['db']=new FakeDB;
function getEntity($key){return '1';}
function dol_buildpath($path,$type=0){return $type===0 ? DOL_DOCUMENT_ROOT.'/custom'.$path:'/custom'.$path;}
function GETPOST($key,$type=''){return $_POST[$key]??$_GET[$key]??'';}
function llxHeader($foo,$title){echo '<!doctype html><html><head><meta charset="utf-8"></head><body><main data-title="'.htmlspecialchars($title).'">';}
function llxFooter(){echo '</main></body></html>';}
function accessforbidden($message='Forbidden'){http_response_code(403); exit($message);}
function newToken(){return 'fixture-dolibarr-token';}
function dol_syslog($message,$level=0){}
if(!defined('LOG_WARNING'))define('LOG_WARNING',4);
return 1;
'''
PRODUCT = r'''<?php
class Product {
 public $id,$type=0,$ref='PART-001',$label='Example Part';
 public function __construct($db){}
 public function fetch($id){$this->id=(int)$id;$this->type=($id===4?1:0);return in_array($id,[3,4],true) ? 1 : -1;}
 public function hasbatch(){return false;}
}
'''
BINLOC = r'''<?php
class BinlocWarehouseLevel {
 public function __construct($db){}
 public function fetchByWarehouse($id){return [];}
}
'''


def assert_in(haystack, needle):
    if needle not in haystack:
        raise AssertionError(f"Missing {needle!r} in output: {haystack[:800]}")


def run():
  with tempfile.TemporaryDirectory(prefix='qrrouter-http-') as temp:
    tmp=Path(temp)
    install=tmp/'htdocs'/'custom'/'qrrouter'
    shutil.copytree(SOURCE, install, ignore=shutil.ignore_patterns('tests'))
    (tmp/'htdocs'/'product'/'class').mkdir(parents=True)
    (tmp/'htdocs'/'custom'/'binloc'/'class').mkdir(parents=True)
    (tmp/'htdocs'/'main.inc.php').write_text(MAIN)
    (tmp/'htdocs'/'product'/'class'/'product.class.php').write_text(PRODUCT)
    (tmp/'htdocs'/'custom'/'binloc'/'class'/'binlocwarehouselevel.class.php').write_text(BINLOC)
    with socket.socket() as s:
      s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    log=open(tmp/'php-server.log','w')
    proc=subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t',str(tmp/'htdocs')],stdout=log,stderr=log)
    try:
      opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),urllib.request.HTTPRedirectHandler())
      base=f'http://127.0.0.1:{port}/custom/qrrouter/'
      def req(page,data=None):
        body=None if data is None else urllib.parse.urlencode(data).encode()
        try:
          with opener.open(base+page,body,timeout=6) as r:
            return r.status,r.geturl(),r.read().decode(errors='replace')
        except urllib.error.HTTPError as e:
          return e.code,e.geturl(),e.read().decode(errors='replace')
      for _ in range(40):
        try:
          req('index.php');break
        except (ConnectionError,urllib.error.URLError):time.sleep(.1)
      status,url,index=req('index.php')
      assert status==200
      assert_in(index,'Unregistered QR batches')
      status,url,print_form=req('print_codes.php')
      assert status==200
      match=re.search(r'name="qrr_token" value="([^"]+)"',print_form)
      assert match, 'Missing CSRF form token'
      token=match.group(1)
      status,url,printed=req('print_codes.php',{'count':'3','qrr_token':token})
      assert status==200 and 'batch_print.php' in url, (status,url,printed[:400])
      state_file=tmp/'data'/'qrrouter'/'entity-1'/'state.json'
      state=json.loads(state_file.read_text())
      assert len(state['items'])==3 and len(state['batches'])==1
      assert all(len(k)==6 for k in state['items']), 'Generated labels must be six characters'
      code=next(iter(state['items']))
      # Manual-entry page is distinct from the automatic camera screen.
      status,url,manual=req('manual.php?intent=register&mode=generic')
      assert status==200
      for field in ('id="qrr-one-code"','id="qrr-many-codes"','name="code"','name="codes"'):
        assert_in(manual,field)
      all_codes=list(state['items'])
      # Returning from manual entry must return to its originating camera workflow.
      camera_destinations = [
          ('manual.php?intent=lookup', 'camera.php', 'QR camera', 'qrr-camera-stage'),
          ('manual.php?intent=register&mode=unique', 'register.php?mode=unique', 'registration camera', 'data-auto-continue="1"'),
          ('manual.php?intent=register&mode=generic', 'register.php?mode=generic', 'registration camera', 'qrr-bulk-selection'),
          ('manual.php?intent=register&mode=box', 'register.php?mode=box', 'registration camera', 'qrr-bulk-selection'),
          ('manual.php?intent=register&mode=unique&copy='+all_codes[0],
           'register.php?mode=unique&copy='+all_codes[0], 'registration camera', 'data-auto-continue="1"'),
          ('manual.php?intent=workflow&action=move', 'workflow.php?action=move', 'Move items camera', 'qrr-bulk-selection'),
          ('manual.php?intent=workflow&action=checkout', 'workflow.php?action=checkout', 'Check out items camera', 'qrr-bulk-selection'),
          ('manual.php?intent=workflow&action=checkin', 'workflow.php?action=checkin', 'Check in items camera', 'qrr-bulk-selection'),
          ('manual.php?intent=workflow&action=consume', 'workflow.php?action=consume', 'Consume items camera', 'qrr-bulk-selection'),
      ]
      for manual_url, expected, label, target_marker in camera_destinations:
          status, url, manual_page=req(manual_url)
          assert status==200, (manual_url,status)
          match=re.search(r'<a class="qrr-btn alt" href="([^"]+)">Back to '+re.escape(label)+r'</a>', manual_page)
          assert match, (manual_url,manual_page[-1200:])
          returned=html.unescape(match.group(1))
          assert returned=='/custom/qrrouter/'+expected, (manual_url,returned)
          status,url,camera_page=req(returned.removeprefix('/custom/qrrouter/'))
          assert status==200 and target_marker in camera_page, (expected,status,camera_page[:300])
      # The POST review step retains the same action for its camera-return link.
      status,url,move_manual_review=req('manual.php',{'step':'review','intent':'workflow','action':'move',
                                                       'code':all_codes[0],'qrr_token':token})
      assert status==200 and 'href="/custom/qrrouter/workflow.php?action=move"' in move_manual_review
      # All scanned rows are selectable and show existing registry information.
      status,url,review_reg=req('register.php',{'step':'review','mode':'generic','codes':'\n'.join(all_codes[:2]),'qrr_token':token})
      assert status==200 and 'Review scanned IDs' in review_reg
      for c in all_codes[:2]:assert_in(review_reg,'name="selected[]" value="'+c+'" checked')
      assert_in(review_reg,'Unassigned QR label')
      assert_in(review_reg,'qrr-review-toggle-all')
      # Only selected entries are passed from the review step to details.
      status,url,selected_detail=req('register.php',{'step':'details','mode':'generic','selected[]':all_codes[0],'qrr_token':token})
      assert status==200 and '1 scanned label(s)' in selected_detail
      assert all_codes[1] not in selected_detail
      # Manual bulk review is informational; it does not mutate inventory.
      snapshot=state_file.read_bytes()
      status,url,manual_review=req('manual.php',{'step':'review','intent':'register','mode':'generic','codes':'\n'.join(all_codes[:2]),'qrr_token':token})
      assert status==200 and 'Review entered IDs' in manual_review
      assert_in(manual_review,'name="selected[]" value="'+all_codes[0]+'" checked')
      assert state_file.read_bytes()==snapshot
      status,url,manual_handoff=req('manual.php',{'step':'continue','intent':'register','mode':'generic','task':'register_generic','selected[]':all_codes[0],'qrr_token':token})
      assert status==200 and 'qrr-manual-handoff' in manual_handoff
      assert_in(manual_handoff,'action="/custom/qrrouter/register.php"')
      assert_in(manual_handoff,'name="step" value="details"')
      assert state_file.read_bytes()==snapshot
      # Invalid manual entry never starts registration and is not selectable.
      status,url,unknown_review=req('manual.php',{'step':'review','codes':'ITM-UNKNOWN123','qrr_token':token})
      assert status==200 and 'Unknown QR' in unknown_review and 'disabled' in unknown_review
      status,url,bad_manual=req('manual.php',{'step':'review','codes':all_codes[0],'qrr_token':'invalid'})
      assert status==200 and 'Invalid or expired form token' in bad_manual
      status,url,batches=req('batches.php')
      assert status==200
      assert_in(batches,'3 unregistered labels')
      assert_in(batches,'step=details')
      status,url,scanning=req('register.php?mode=unique')
      assert status==200
      assert_in(scanning,'data-auto-continue="1"')
      assert_in(scanning,'assets/workflow-ui.css?v=2.6.10')
      assert_in(scanning,'assets/camera-decoder.js?v=2.6.14')
      assert_in(scanning,'assets/code.js?v=2.6.14')
      assert_in(scanning,'assets/scanner.js?v=2.6.14')
      status,url,camera=req('camera.php')
      assert status==200
      assert_in(camera,'assets/workflow-ui.css?v=2.6.10')
      assert_in(camera,'assets/camera-decoder.js?v=2.6.14')
      assert_in(camera,'assets/code.js?v=2.6.14')
      assert_in(camera,'assets/camera-page.js?v=2.6.14')
      assert_in(camera,'manual.php')
      assert_in(camera,'qrr-camera-stage')
      status,url,move_scan=req('workflow.php?action=move')
      assert status==200
      assert_in(move_scan,'assets/workflow-ui.css?v=2.6.10')
      assert_in(move_scan,'assets/camera-decoder.js?v=2.6.14')
      status,url,details=req('register.php',{'step':'details','mode':'unique','codes':code,'qrr_token':token})
      assert status==200
      assert_in(details,'External serial / DeltaCube ID')
      assert_in(details,'Scanned QR label')
      assert_in(details,code)
      # Invalid product selection must preserve the detail form with editable input.
      post={'step':'save','mode':'unique','codes':code,'qrr_token':token,
            'label':'Test Sensor','serial':'DIOT-SN1','warehouse_id':'1','product_id':'0','next':'copy'}
      status,url,invalid=req('register.php',post)
      assert status==200 and 'Choose a product' in invalid, (status, invalid[invalid.find('</h2>'):invalid.find('</h2>')+500])
      assert_in(invalid,'value="Test Sensor"')
      post['product_id']='4'
      status,url,service=req('register.php',post)
      assert status==200 and 'Select a physical Dolibarr product' in service
      post['product_id']='3'
      status,url,saved=req('register.php',post)
      assert status==200 and 'register.php?mode=unique' in url and 'copy=' in url, (status,url,saved[:500])
      state=json.loads(state_file.read_text())
      assert state['items'][code]['type']=='tracked' and state['items'][code]['serial']=='DIOT-SN1'
      # Item detail must offer Move/Consume directly, using GET only for the review page.
      status,url,item_page=req('scan.php?code='+code)
      assert status==200
      assert_in(item_page,'Move this item')
      assert_in(item_page,'Consume this item')
      # Known labels lead; the stable QR identifier remains smaller and copyable.
      assert_in(item_page,'Item: Test Sensor')
      assert_in(item_page,'class="qrr-item-code-muted">QR '+code)
      status,url,inventory=req('index.php')
      assert status==200
      assert_in(inventory,'class="qrr-item-name" href="/custom/qrrouter/scan.php?code='+code+'">Test Sensor</a>')
      assert_in(inventory,'class="qrr-item-id">QR '+code+'</small>')
      assert_in(item_page,'action=move&amp;code='+code)
      assert_in(item_page,'action=consume&amp;code='+code)
      before=state_file.read_bytes()
      for verb in ['move','consume']:
        status,url,review=req('workflow.php?action='+verb+'&code='+code)
        assert status==200 and 'Review scanned items' in review, (verb,status,review[:500])
        assert_in(review,'assets/review.js?v=2.6.14')
        assert_in(review,'name="selected[]" value="'+code+'" checked')
      assert state_file.read_bytes()==before, 'Opening item shortcuts must not change inventory'
      # Scan review is actionable: registered stock is checked; unassigned labels
      # stay visible but are disabled, so the user can exclude them safely.
      unassigned=next(c for c,e in state['items'].items() if e['type']=='unassigned')
      status,url,review_mixed=req('workflow.php?action=move',{'action':'move','step':'review','codes':code+'\n'+unassigned,'qrr_token':token})
      assert status==200 and 'Review scanned items' in review_mixed
      assert_in(review_mixed,'name="selected[]" value="'+code+'" checked')
      assert_in(review_mixed,'class="qrr-item-id">QR '+code+'</small>')
      assert_in(review_mixed,'name="selected[]" value="'+unassigned+'" disabled')
      assert state_file.read_bytes()==before
      # Deep links cannot trigger an inventory mutation and cannot select unknown labels.
      status,url,bad_deeplink=req('workflow.php?action=consume&code=QR-UNKNOWN123')
      assert status==200 and 'Unknown QR label' in bad_deeplink
      # Transaction references are browsable without typing, across all supported types.
      for kind,ref in [('production','MO-0019'),('salesorder','SO-0039'),('shipment','SHP-0029')]:
        status,url,payload=req('reference_lookup.php?type='+kind)
        assert status==200 and any(x['text']==ref for x in json.loads(payload)), (kind,status,payload)
      status,url,payload=req('order_lookup.php')
      assert status==200 and json.loads(payload)[0]['id']==39, (status,payload)
      status,url,pick_form=req('pick.php')
      assert status==200 and 'qrr-lookup-results' in pick_form
      status,url,next_scan=req('register.php?mode=unique&copy='+code)
      assert status==200 and 'Scan one unassigned label' in next_scan
      remaining=next(c for c,e in state['items'].items() if e['type']=='unassigned')
      status,url,details2=req('register.php',{'step':'details','mode':'unique','codes':remaining,'copy':code,'qrr_token':token})
      assert status==200 and 'value="Test Sensor"' in details2
      assert_in(details2,'value=""')
      status,url,summary=req('register_summary.php')
      assert status==200 and '1 registered item(s)' in summary
      status,url,batches=req('batches.php')
      assert status==200 and '2 unregistered labels' in batches
      assert_in(batches,'Print remaining 2')
      # Unknown label, already-assigned label and multiple codes must not create stock.
      for candidate in [code,'QR-UNKNOWN123','\n'.join(state['items'])]:
        status,url,bad=req('register.php',{'step':'details','mode':'unique','codes':candidate,'qrr_token':token})
        assert status==200 and 'qrr-alert' in bad,(candidate,bad[:300])
      # Exercise Save and Next (New), then both remaining registration modes.
      post2={'step':'save','mode':'unique','codes':remaining,'qrr_token':token,
             'label':'Test Sensor','serial':'DIOT-SN2','warehouse_id':'1','product_id':'3','next':'new'}
      status,url,saved2=req('register.php',post2)
      assert status==200 and 'registered=' in url and 'copy=' not in url
      state=json.loads(state_file.read_text())
      assert state['items'][remaining]['serial']=='DIOT-SN2'
      status,url,summary=req('register_summary.php')
      assert status==200 and '2 registered item(s)' in summary
      # Register two generic items in one save, using another printable batch.
      status,url,again=req('print_codes.php',{'count':'3','qrr_token':token})
      state=json.loads(state_file.read_text())
      remaining_codes=[c for c,e in state['items'].items() if e['type']=='unassigned']
      assert len(remaining_codes)==4
      generic_codes=remaining_codes[:2]
      status,url,generic_details=req('register.php',{'step':'details','mode':'generic',
                   'codes':'\n'.join(generic_codes),'qrr_token':token})
      assert status==200 and '2 scanned label(s)' in generic_details
      status,url,generic_saved=req('register.php',{'step':'save','mode':'generic',
                   'codes':'\n'.join(generic_codes),'label':'Cable tie','product_id':'3',
                   'warehouse_id':'1','next':'finish','qrr_token':token})
      assert status==200 and 'register_summary.php' in url
      state=json.loads(state_file.read_text())
      assert all(state['items'][c]['type']=='generic' for c in generic_codes)
      box=remaining_codes[2]
      status,url,box_details=req('register.php',{'step':'details','mode':'box','codes':box,'qrr_token':token})
      assert status==200 and 'Quantity in container' in box_details
      status,url,box_saved=req('register.php',{'step':'save','mode':'box','codes':box,'label':'Box of screws',
                    'qty':'27','product_id':'3','warehouse_id':'1','qrr_token':token,'next':'finish'})
      assert status==200 and 'register_summary.php' in url
      state=json.loads(state_file.read_text())
      assert state['items'][box]['type']=='box' and state['items'][box]['qty']==27
      # Destination-box scanning also retains the source box on the manual round trip.
      status,url,box_manual=req('manual.php?intent=boxdest&from='+box)
      assert status==200 and ('camera.php?mode=boxdest&amp;from='+box) in box_manual
      status,url,box_camera=req('camera.php?mode=boxdest&from='+box)
      assert status==200 and 'Source container <strong>Box of screws</strong>' in box_camera and ('QR '+box) in box_camera
      status,url,summary=req('register_summary.php')
      assert status==200 and '5 registered item(s)' in summary
      print('HTTP workflow tests passed: registrations, summary, QR detail/deep links, MRP/sales/shipment reference APIs, picking selector and batch counts.')
    finally:
      proc.terminate()
      with contextlib.suppress(Exception):proc.wait(timeout=2)
      log.close()

if __name__=='__main__':run()
