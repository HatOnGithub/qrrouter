#!/usr/bin/env python3
"""Browser regression: mobile menu alignment, registration spacing, camera size, selectable review."""
from pathlib import Path
import shutil, subprocess
root=Path(__file__).resolve().parents[1]
if not shutil.which('chromium'):
    print('Workflow UI browser test SKIPPED (Chromium unavailable)')
    raise SystemExit(0)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('Workflow UI browser test SKIPPED (Playwright unavailable)')
    raise SystemExit(0)
php=r'''define('DOL_DOCUMENT_ROOT','/tmp/qrr-browser-fixture');
define('DOL_DATA_ROOT','/tmp/qrr-browser-fixture-data');
$conf=(object)['entity'=>1];
function dol_buildpath($path,$type){return '/custom'.$path;}
require '''+repr(str(root/'lib/qrrouter.lib.php'))+r''';
class TestUser{public $admin=1; public function hasRight(...$args){return true;}}
$state=qrr_blank();
foreach(['ITM-ABCDEF','ITM-ABCDGH','QR-ABCDEF12'] as $c) $state['items'][$c]=qrr_make_item($c,'generic','Demo item',3,1,array('bin'=>'A/2','bin_key'=>'','bin_values'=>[]));
$w=[1=>['ref'=>'Warehouse 1']];
print qrr_nav_html(new TestUser(), '/custom/qrrouter/manual.php','');
print '<div class="qrr-panel"><div class="qrr-grid qrr-registration-options">';
for($i=0;$i<3;$i++)print '<div class="qrr-panel qrr-option-card"><h3>Option '.($i+1).'</h3><p>Register products</p><a class="qrr-btn">Select</a></div>';
print '</div></div>';
print '<div class="qrr-panel"><div class="qrr-camera-stage"><video autoplay muted playsinline></video><div class="qrr-camera-placeholder">Opening camera</div></div></div>';
print '<form id="review" class="qrr-panel"><h3>Review scans</h3>'.qrr_scan_review_table(array_keys($state['items']),$state,$w).'<p class="qrr-review-error"></p><button type="submit">Continue</button></form>';
'''
markup=subprocess.check_output(['php','-r',php],text=True)
css=(root/'assets/navigation.css').read_text()+'\n'+(root/'assets/workflow-ui.css').read_text()
js=(root/'assets/navigation.js').read_text()+'\n'+(root/'assets/review.js').read_text()
html=f'''<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{{margin:0;padding:8px;background:#f6f9fc;font-family:Arial,sans-serif;color:#1d3245}}.qrr{{max-width:1100px;margin:0 auto}}.qrr-panel{{padding:12px;margin:12px 0;border:1px solid #d5dbe2;border-radius:10px;background:white}}.qrr-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}}.qrr-btn{{display:inline-block;padding:10px;background:#174a7a;color:white;border-radius:6px}}.qrr-input{{box-sizing:border-box;width:100%;font-size:16px}}
{css}</style></head><body><div class="qrr">{markup}</div><script>{js}</script></body></html>'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],timeout=12000)
    try:
        for width,height in ((320,600),(390,844),(390,450),(768,700),(1280,800),(1440,900)):
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
            page.set_content(html,wait_until='domcontentloaded',timeout=12000)
            assert page.locator('.qrr-registration-options .qrr-option-card').count()==3
            camera=page.locator('.qrr-camera-stage video')
            # A high-resolution stream must not stretch the visual preview.
            camera.evaluate('(el)=>{el.width=3840;el.height=2160}')
            stage=page.locator('.qrr-camera-stage')
            camera_box=camera.bounding_box()
            stage_box=stage.bounding_box()
            camera_height=camera_box['height']
            assert stage_box['width']<= (420 if width<=680 else 480)+1,(width,'stage too wide',stage_box)
            assert stage_box['height']<= (240 if width<=680 else 270)+1,(width,'stage too tall',stage_box)
            assert stage_box['height']>= (170 if width<=680 else 190)-1,(width,'stage too short',stage_box)
            assert stage_box['x']>=0 and stage_box['x']+stage_box['width']<=width+1,(width,'horizontal overflow',stage_box)
            assert abs(camera_box['height']-stage_box['height'])<=3,(width,'video overflow',camera_box,stage_box)
            assert abs(camera_box['width']-stage_box['width'])<=3,(width,'video overflow',camera_box,stage_box)
            # Camera stop() uses inline display:none; avoid !important display rules.
            camera.evaluate('(el)=>el.style.display="none"')
            assert camera.evaluate('(el)=>getComputedStyle(el).display')=='none',(width,'camera stop visibility')
            camera.evaluate('(el)=>el.style.display="block"')
            assert page.locator('.qrr-review-table .qrr-review-check').count()==3
            if width<=1000:
                page.locator('.qrr-nav-menu-toggle').click()
                page.wait_for_selector('.qrr-nav-mobile-panel.qrr-nav-floating', state='visible', timeout=3000)
                links=page.locator('.qrr-nav-mobile-panel.qrr-nav-floating .qrr-nav-mobile-link')
                assert links.count() >= 12
                first=links.nth(0);second=links.nth(1)
                m=first.evaluate('(el)=>({size:parseFloat(getComputedStyle(el).fontSize),align:getComputedStyle(el).alignItems,height:el.getBoundingClientRect().height})')
                assert m['size']<=14 and m['align']=='center' and 38<=m['height']<=48,(width,m)
                a=first.bounding_box();b=second.bounding_box()
                assert b['y']-(a['y']+a['height'])>=2,(width,'missing link gap',a,b)
                page.keyboard.press('Escape')
            if width<=390:
                options=page.locator('.qrr-option-card')
                a=options.nth(0).bounding_box();b=options.nth(1).bounding_box()
                gap=b['y']-(a['y']+a['height'])
                assert 4<=gap<=14,(width,'registration card spacing',gap)
                review=page.locator('.qrr-review-scroll')
                assert review.evaluate('(el)=>el.scrollWidth>el.clientWidth'),(width,'review needs horizontal scroll')
            if width==390:
                allbox=page.locator('.qrr-review-toggle-all')
                allbox.uncheck()
                assert page.locator('.qrr-review-check:checked').count()==0
                assert '0 of 3 selected' in page.locator('.qrr-review-count').inner_text()
                page.locator('.qrr-review-check').first.check()
                assert page.locator('.qrr-review-check:checked').count()==1
                assert '1 of 3 selected' in page.locator('.qrr-review-count').inner_text()
                allbox.check()
                assert page.locator('.qrr-review-check:checked').count()==3
            print(f'Workflow UI PASS at {width}px (camera {camera_height:.0f}px)')
            page.close()
    finally:
        browser.close()
