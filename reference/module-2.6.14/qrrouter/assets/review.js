(function(){'use strict';
const tr = s => (typeof window !== 'undefined' && window.QRR_UI?.[s]) || s;
for(const form of document.querySelectorAll('form:has(.qrr-review-table)')){
 const checks=[...form.querySelectorAll('.qrr-review-check:not([disabled])')];
 const all=form.querySelector('.qrr-review-toggle-all');
 const count=form.querySelector('.qrr-review-count');
 function update(){const selected=checks.filter(c=>c.checked).length;
  if(count)count.textContent=selected+tr(' of ')+checks.length+tr(' selected');
  if(all){all.checked=selected===checks.length&&checks.length>0;all.indeterminate=selected>0&&selected<checks.length;}
 }
 if(all)all.addEventListener('change',()=>{checks.forEach(c=>{c.checked=all.checked;});update();});
 checks.forEach(c=>c.addEventListener('change',update));
 form.addEventListener('submit',e=>{if(!checks.some(c=>c.checked)){e.preventDefault();const t=form.querySelector('.qrr-review-error');if(t)t.textContent=tr('Select at least one item to continue.');}});
 update();
}
})();
