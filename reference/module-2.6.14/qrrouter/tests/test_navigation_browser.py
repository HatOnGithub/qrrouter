#!/usr/bin/env python3
"""Optional desktop/mobile visual-interaction checks (requires Chromium + playwright)."""
import pathlib, subprocess, shutil
root=pathlib.Path(__file__).resolve().parents[1]
if not shutil.which('chromium'):
    print('Navigation browser test SKIPPED (Chromium unavailable)')
    raise SystemExit(0)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('Navigation browser test SKIPPED (Playwright unavailable)')
    raise SystemExit(0)
# Use PHP to render exactly the navigation used by the application.
php=r'''define('DOL_DOCUMENT_ROOT','/tmp/qrr-browser-fixture'); function dol_buildpath($path,$type){return '/custom'.$path;} require ''' + repr(str(root/'lib/qrrouter.lib.php')) + r'''; class NavUser {public $admin=1; public function hasRight(...$args){return true;}} echo qrr_nav_html(new NavUser(),'/custom/qrrouter/workflow.php','consume');'''
markup=subprocess.check_output(['php','-r',php], text=True)
css=(root/'assets/navigation.css').read_text()
js=(root/'assets/navigation.js').read_text()
html=f'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{{margin:0;padding:14px;font-family:Arial,sans-serif;background:#f4f6f9}}.qrr{{max-width:1120px;margin:0 auto}}
{css}
</style></head><body><div class="qrr">{markup}<h2>Consume items</h2></div><script>{js}</script></body></html>'''
if True:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],timeout=9000)
        try:
            for width,height in [(1280,800),(1001,750),(1000,750),(820,700),(390,700),(320,650)]:
                page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
                page.set_content(html,wait_until='domcontentloaded',timeout=9000)
                desktop=width>1000
                assert page.locator('.qrr-nav-desktop').is_visible() is desktop,(width,'desktop visibility')
                assert page.locator('.qrr-nav-mobile-actions').is_visible() is (not desktop),(width,'mobile visibility')
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),(width,'horizontal overflow')
                if desktop:
                    summary=page.locator('.qrr-nav-dropdown-toggle').first
                    summary.click()
                    panel=page.locator('#'+summary.get_attribute('aria-controls'))
                    assert panel.is_visible()
                    assert page.locator('.qrr-nav-popover a.is-current').count()==1,(width,'active navigation item')
                    box=panel.bounding_box()
                    assert box['x']>=-1 and box['x']+box['width']<=width+1,(width,'popover bounds',box)
                    page.keyboard.press('Escape')
                    assert not panel.is_visible(),(width,'escape close')
                else:
                    page.locator('.qrr-nav-menu-toggle').click()
                    panel=page.locator('.qrr-nav-mobile-panel')
                    assert panel.is_visible(),(width,'panel visible')
                    assert panel.locator('a').count()>=12,(width,'all links')
                    metrics=panel.evaluate('(el)=>({w:el.scrollWidth,cw:el.clientWidth,h:el.scrollHeight,ch:el.clientHeight})')
                    assert metrics['w']<=metrics['cw']+2,(width,'menu horizontal overflow',metrics)
                    assert metrics['h']>metrics['ch'],(width,'vertical scroll',metrics)
                    panel.hover()
                    page.mouse.wheel(0, 340)
                    page.wait_for_timeout(150)
                    assert panel.evaluate('(el)=>el.scrollTop')>0,(width,'wheel scrolling')
                    assert page.locator('.qrr-nav-scan').is_visible(),(width,'quick scan')
                    assert page.locator('.qrr-nav-scan').evaluate('(el)=>getComputedStyle(el).color')=='rgb(255, 255, 255)',(width,'scan button contrast')
                    page.keyboard.press('Escape')
                    assert not panel.is_visible(),(width,'escape close')
                print(f'Navigation browser PASS at {width}px')
                page.close()
        finally:browser.close()
