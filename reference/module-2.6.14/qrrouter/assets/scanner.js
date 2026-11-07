/* Camera-first selection. Hidden code list is posted to the existing workflow; manual
 * typing lives on manual.php. Hardware keyboard scanners remain supported when
 * a legacy input exists. Serialised Unique still opens details immediately. */
(function(){'use strict';
const tr = s => (typeof window !== 'undefined' && window.QRR_UI?.[s]) || s;
const form=document.getElementById('qrr-bulk-selection');if(!form)return;
const input=document.getElementById('qrr-scan-input');
const codes=document.getElementById('qrr-scanned-codes');
const preview=document.getElementById('qrr-selected-scans');
const status=document.getElementById('qrr-scan-status');
const video=document.getElementById('qrr-camera-video');
const stage=document.getElementById('qrr-camera-stage');
const thumbnail=document.getElementById('qrr-scan-thumbnail');
const toggle=document.getElementById('qrr-camera-toggle');
const addButton=document.getElementById('qrr-add');
const autoContinue=form.dataset.autoContinue==='1';
const valid=value=>window.QRRCode.valid(value);
let submitting=false;
function values(){return [...new Set(codes.value.toUpperCase().split(/[\s,;]+/).filter(Boolean))];}
function render(){const list=values();preview.textContent='';
 const title=document.createElement('p');title.textContent=list.length+tr(list.length===1?' unique code':' unique codes')+tr(' scanned');preview.appendChild(title);
 for(const v of list){const tag=document.createElement('span');tag.textContent=v;tag.className='qrr-tag';tag.style.marginRight='10px';preview.appendChild(tag);}
}
/** Camera scans crop the detected code to 144x144. */
function snapshot(hit){
 if(!autoContinue || !thumbnail || !video.videoWidth || !video.videoHeight)return;
 try{
  const w=video.videoWidth,h=video.videoHeight,r=hit?.boundingBox;
  const size=Math.min(w,h),side=r?.width&&r?.height?Math.min(size,Math.max(r.width,r.height)*1.4):size;
  const cx=r?.x!==undefined?r.x+r.width/2:w/2;
  const cy=r?.y!==undefined?r.y+r.height/2:h/2;
  const sx=Math.max(0,Math.min(w-side,cx-side/2)),sy=Math.max(0,Math.min(h-side,cy-side/2));
  const canvas=document.createElement('canvas');canvas.width=144;canvas.height=144;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.drawImage(video,sx,sy,side,side,0,0,144,144);
  const encoded=canvas.toDataURL('image/jpeg',0.66);
  if(encoded.length<=100000)thumbnail.value=encoded;
 }catch(_){/* Thumbnail optional. */}
}
let camera;
function add(value,hit){
 if(submitting)return false;
 value=window.QRRCode.normalize(value);
 if(!valid(value)){status.textContent=tr('Invalid identifier: ')+value;return false;}
 const all=values();
 if(all.includes(value)){status.textContent=tr('Already scanned: ')+value;return false;}
 if(all.length>=200){status.textContent=tr('Maximum 200 codes per round');return false;}
 if(autoContinue&&all.length){status.textContent=tr('Serialised Unique accepts one label at a time');return false;}
 if(autoContinue&&hit)snapshot(hit);
 all.push(value);codes.value=all.join('\n');if(input)input.value='';status.textContent=tr('Added ')+value;render();
 if(autoContinue){
   submitting=true;status.textContent=tr('Opening details for ')+value+'…';
   camera.stop();
   if(typeof form.requestSubmit==='function')form.requestSubmit();else form.submit();
 }
 return true;
}
camera=new window.QRRCameraScanner(video, {
 onStatus:message=>{status.textContent=message;},
 onState:active=>{if(toggle)toggle.textContent=active?tr('Stop camera'):tr('Restart camera');if(stage?.classList?.toggle)stage.classList.toggle('qrr-camera-active',active);},
 onDecode:(value,hit)=>add(value,hit)
});
if(input)input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add(input.value);}});
if(addButton)addButton.addEventListener('click',()=>add(input?.value));
codes.addEventListener('input',render);
form.addEventListener('submit',e=>{
 if(!submitting && !values().length && input?.value?.trim()){e.preventDefault();add(input.value);return;}
 if(!values().length){e.preventDefault();status.textContent=tr('Scan at least one QR code, or use manual entry.');return;}
 if(autoContinue && values().length!==1){e.preventDefault();status.textContent=tr('Scan exactly one QR label');}
});
if(toggle)toggle.addEventListener('click',async()=>{
 if(camera.active||camera.starting){camera.stop();return;}
 try{await camera.start();}catch(err){status.textContent=tr('Camera error: ')+(err.message||String(err));}
});
async function autoStart(){if(form.dataset.autoCamera!=='1')return;
 try{await camera.start();}catch(err){status.textContent=tr('Camera unavailable: ')+(err.message||String(err))+tr(' Use Restart camera or Enter codes manually.');if(stage){const p=stage.querySelector?.('.qrr-camera-placeholder');if(p)p.textContent=tr('Camera unavailable — use Restart camera or Enter codes manually.');}}
}
window.addEventListener('load',autoStart);
window.addEventListener('pagehide',()=>camera.stop());render();
})();
