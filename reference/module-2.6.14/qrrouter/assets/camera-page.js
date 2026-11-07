(function() {
'use strict';
const tr = s => (typeof window !== 'undefined' && window.QRR_UI?.[s]) || s;
const video=document.getElementById('qrr-video');if(!video)return;
const status=document.getElementById('qrr-status');
const start=document.getElementById('qrr-start');
const stop=document.getElementById('qrr-stop');
const form=document.getElementById('qrr-manual');
const code=document.getElementById('qrr-code');
const stage=document.getElementById('qrr-camera-stage');
const valid=value=>window.QRRCode.valid(value);
const scanner=new window.QRRCameraScanner(video,{
 onStatus:message=>{status.textContent=message;},
 onState:active=>{start.textContent=active?tr('Camera running'):tr('Restart camera');start.disabled=active;if(stage?.classList?.toggle)stage.classList.toggle('qrr-camera-active',active);},
 onDecode:value=>{
  value=window.QRRCode.normalize(value);
  if(!valid(value)){status.textContent=tr('QR does not contain a valid inventory identifier: ')+value;return false;}
  code.value=value;
  scanner.stop();
  form.submit();
  return true;
 }
});
async function startCamera(){start.disabled=true;
 try{await scanner.start();}
 catch(err){status.textContent=tr('Camera unavailable: ')+(err.message||String(err))+tr(' Enter codes manually if needed.');if(stage){const p=stage.querySelector?.('.qrr-camera-placeholder');if(p)p.textContent=tr('Camera unavailable — use Restart camera or Enter codes manually.');}}
 finally{if(!scanner.active)start.disabled=false;}
}
start.addEventListener('click',startCamera);
stop.addEventListener('click',()=>scanner.stop());
window.addEventListener('load',startCamera);
window.addEventListener('pagehide',()=>scanner.stop());
})();
