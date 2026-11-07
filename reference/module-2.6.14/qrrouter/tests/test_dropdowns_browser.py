#!/usr/bin/env python3
"""Use Chromium (if installed) to check scrolling, viewport width, dynamic Binloc selects."""
import os, pathlib, re, shutil, subprocess, tempfile, textwrap
root=pathlib.Path(__file__).resolve().parents[1]
browser=shutil.which('chromium') or shutil.which('google-chrome')
if browser is None:
    print('Dropdown browser visual-logic test SKIPPED (Chromium unavailable)')
    raise SystemExit(0)
html= textwrap.dedent('''
<!doctype html><html><head>
<meta charset="utf-8"><link rel="stylesheet" href="../assets/dropdowns.css">
<style>
  body{margin:0;font:16px Arial,sans-serif;}
  .qrr{max-width:900px;margin:0 auto;padding:20px}
  .qrr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .qrr-input{box-sizing:border-box;width:100%;padding:11px;font:inherit;border:1px solid #aaa;border-radius:5px}
  .qrr-lookup-option{display:block;width:100%;padding:10px;white-space:normal}
</style><script src="../assets/dropdowns.js" defer></script>
</head><body><div class="qrr"><div class="qrr-grid">
<div><label for="warehouse">Warehouse</label><select id="warehouse" name="warehouse" class="qrr-input" required></select></div>
<div><label for="location">Location</label><select id="location" class="qrr-input"><option value="">Choose</option><option value="a">Option A</option></select></div>
<div><input id="qrr-product-search" class="qrr-input" placeholder="Product"><div id="qrr-product-results" hidden></div></div>
<div id="dynamic"></div></div></div>
<script>
for(let i=0;i<100;i++) {
 const o=document.createElement('option');o.value=String(i);o.textContent='Option '+i+' — '+('extra long text '.repeat(12));
 document.getElementById('warehouse').append(o);
}
window.addEventListener('load',()=>setTimeout(()=>{
 const result=[];
 const fail=(x)=>result.push('FAIL:'+x);
 const ok=(x)=>result.push('PASS:'+x);
 const b=document.querySelector('#warehouse').parentNode.querySelector('button.qrr-select-button');
 if(!b) {document.body.setAttribute('data-tests','FAIL:NO-ENHANCEMENT');return;}
 b.click();
 const pop=document.querySelector('.qrr-select-popup:not([hidden])');
 const choices=pop?.querySelector('.qrr-select-options');
 if(!pop || !choices)fail('open');else{
  const bounds=pop.getBoundingClientRect(),vw=document.documentElement.clientWidth;
  if(bounds.width<=680.5 && bounds.width>=250 && bounds.right<=vw+1 && bounds.left>=0)ok('bounded width');else fail('bounded width '+JSON.stringify([bounds.width,bounds.left,bounds.right,vw]));
  if(choices.scrollHeight>choices.clientHeight && choices.clientHeight<=340)ok('scrollable large options');else fail('scrollable '+choices.scrollHeight+'/'+choices.clientHeight);
  const option=choices.querySelectorAll('button');option[75].click();
  if(document.getElementById('warehouse').value==='75')ok('selection');else fail('selection');
 }
 const dynamic=document.getElementById('dynamic');dynamic.innerHTML='<label>Binloc</label><select class="qrr-input" id="binloc"><option value="">Not assigned</option><option value="2">Shelf 2</option></select>';
 setTimeout(()=>{
  const d=dynamic.querySelector('.qrr-select-button');
  if(d){d.click();const p=document.querySelector('.qrr-select-popup:not([hidden])');
   if(p && p.getBoundingClientRect().right<=document.documentElement.clientWidth+1)ok('dynamic binloc');else fail('dynamic binloc popup');
  }else fail('dynamic binloc');
  const list=document.getElementById('qrr-product-results');
  for(let i=0;i<80;i++){
   const opt=document.createElement('button');opt.className='qrr-lookup-option'; opt.textContent='Lookup result '+i+' '+('very long '.repeat(10));list.appendChild(opt);
  }
  list.hidden=false;
  setTimeout(()=>{
   const box=list.getBoundingClientRect();
   if(!list.hidden && box.width<=680.5 && box.right<=document.documentElement.clientWidth+1 && list.scrollHeight>list.clientHeight && list.clientHeight<=340.5)ok('lookup width and scroll');
   else fail('lookup width and scroll '+JSON.stringify([box.width,box.right,list.scrollHeight,list.clientHeight]));
   document.body.setAttribute('data-tests',result.join('|'));
  },50);
 },50);
},100));
</script></body></html>
''')
fixture=root/'tests'/'dropdowns_browser_fixture.html'
fixture.write_text(html)
try:
    for width,height in [(1024,768),(420,600)]:
        args=[browser,'--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage', '--disable-background-networking', '--window-size=%d,%d'%(width,height),'--virtual-time-budget=4000','--dump-dom',fixture.as_uri()]
        run=subprocess.run(args, text=True, capture_output=True, timeout=35)
        results=re.search(r'data-tests="([^"]+)"',run.stdout)
        if not results:
            raise AssertionError('Chromium produced no test results for width %d; rc=%s: %s'%(width,run.returncode,run.stderr[-1200:]))
        print(width,results.group(1))
        if 'FAIL:' in results.group(1):raise AssertionError('Browser selector test failed at %s px'%width)
finally:
    fixture.unlink(missing_ok=True)
print('Chromium dropdown layout tests PASSED')
