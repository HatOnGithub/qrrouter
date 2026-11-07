#!/usr/bin/env python3
"""Regression: nav menus must escape Dolibarr clipping and high-z overlays."""
import pathlib
import shutil
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
if not shutil.which('chromium'):
    print('Navigation overlay browser SKIPPED (Chromium unavailable)')
    raise SystemExit(0)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('Navigation overlay browser SKIPPED (Playwright unavailable)')
    raise SystemExit(0)

php = (
    "define('DOL_DOCUMENT_ROOT','/tmp/qrr-overlay-fixture');"
    "function dol_buildpath($path,$type){return '/custom'.$path;}"
    "require " + repr(str(root / 'lib/qrrouter.lib.php')) + ";"
    "class NavUser {public $admin=1; public function hasRight(...$args){return true;}}"
    "echo qrr_nav_html(new NavUser(),'/custom/qrrouter/workflow.php','consume');"
)
markup = subprocess.check_output(['php', '-r', php], text=True)
css = (root / 'assets/navigation.css').read_text()
js = (root / 'assets/navigation.js').read_text()
html = f'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body {{ margin:0; padding:14px; font-family:Arial,sans-serif; background:#f4f6f9 }}
.fixture-clip {{ transform:translateZ(0); overflow:hidden; height:76px; position:relative; z-index:1 }}
.qrr {{ max-width:1120px; margin:0 auto }}
.fixture-blocker {{position:fixed;z-index:999999;top:91px;left:0;right:0;height:280px;background:#e8e8e8}}
{css}
</style></head><body><div class="fixture-clip"><div class="qrr">{markup}</div></div><div class="fixture-blocker" aria-hidden="true"></div><script>{js}</script></body></html>'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=shutil.which('chromium'), headless=True,
                                 args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], timeout=12000)
    try:
        for width, height in [(1280, 800), (1024, 700), (1000, 680), (390, 650), (320, 440), (375, 280)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.set_content(html, wait_until='domcontentloaded', timeout=12000)
            desktop = width > 1000
            buttons = page.locator('.qrr-nav-dropdown-toggle') if desktop else page.locator('.qrr-nav-menu-toggle')
            panels = page.locator('.qrr-nav-popover') if desktop else page.locator('.qrr-nav-mobile-panel')
            expected = 3 if desktop else 1
            assert buttons.count() == expected, (width, 'menu count')
            for i in range(expected):
                buttons.nth(i).click()
                panel = page.locator('#' + buttons.nth(i).get_attribute('aria-controls'))
                page.wait_for_function('el => el.classList.contains("qrr-nav-floating")', arg=panel.element_handle())
                metrics = panel.evaluate('''el=>{
                    const b=el.getBoundingClientRect();
                    const a=el.querySelector('a').getBoundingClientRect();
                    const hit=document.elementFromPoint(a.left+Math.min(18,a.width/2),a.top+a.height/2);
                    return {height:b.height,width:b.width,left:b.left,right:b.right,top:b.top,bottom:b.bottom,
                            pos:getComputedStyle(el).position,z:getComputedStyle(el).zIndex,
                            scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
                            hit:!!(hit && (el===hit || el.contains(hit)))};
                }''')
                assert metrics['pos'] == 'fixed', (width, i, 'not fixed', metrics)
                assert int(metrics['z']) > 999999, (width, i, 'overlay stacking', metrics)
                assert 47 <= metrics['height'] <= height, (width, i, 'invalid height', metrics)
                assert metrics['left'] >= -1 and metrics['right'] <= width + 1, (width, i, 'horizontal bounds', metrics)
                assert metrics['top'] >= -1 and metrics['bottom'] <= height + 1, (width, i, 'vertical bounds', metrics)
                assert metrics['hit'], (width, i, 'covered by page overlay', metrics)
                # Portal must not cause body horizontal overflow.
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (width, i, 'page overflow')
                page.keyboard.press('Escape')
                page.wait_for_function('el => !el.classList.contains("qrr-nav-floating")', arg=panel.element_handle())
                assert not panel.is_visible(), (width, i, 'Escape close')
            if desktop:
                # Opening a different group must close (and undock) the old popup.
                buttons.first.click()
                first = page.locator('#' + buttons.first.get_attribute('aria-controls'))
                buttons.nth(1).click()
                second = page.locator('#' + buttons.nth(1).get_attribute('aria-controls'))
                page.wait_for_function('el => el.classList.contains("qrr-nav-floating")', arg=second.element_handle())
                page.wait_for_function('el => !el.classList.contains("qrr-nav-floating")', arg=first.element_handle())
                assert not first.is_visible(), (width, 'previous menu still visible')
                page.keyboard.press('Escape')
            # In a short viewport, the popup must fit available space and remain scrollable.
            if height <= 440:
                buttons.first.click()
                panel = page.locator('#' + buttons.first.get_attribute('aria-controls'))
                page.wait_for_function('el => el.classList.contains("qrr-nav-floating")', arg=panel.element_handle())
                assert panel.evaluate('(el)=>el.scrollHeight > el.clientHeight'), (width, 'menu should scroll')
                panel.hover(position={'x': 20, 'y': 25})
                page.mouse.wheel(0, 320)
                page.wait_for_timeout(150)
                assert panel.evaluate('(el)=>el.scrollTop') > 0, (width, 'wheel scrolling')
            if width == 1280:
                buttons.first.click()
                first = page.locator('#' + buttons.first.get_attribute('aria-controls'))
                page.wait_for_function('el => el.classList.contains("qrr-nav-floating")', arg=first.element_handle())
                page.set_viewport_size({'width': 390, 'height': 650})
                page.wait_for_function('el => !el.classList.contains("qrr-nav-floating")', arg=first.element_handle())
                assert not first.is_visible(), 'desktop popup remains open after switching to mobile layout'
            print(f'Overlay/navigation browser PASS at {width}x{height}px')
            page.close()
    finally:
        browser.close()
