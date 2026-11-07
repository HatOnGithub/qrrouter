/* Browser logic smoke tests: keyboard scanning, native detection, Firefox software
 * detection and the Serialised Unique immediate detail/thumbnail flow.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const asset=f=>fs.readFileSync(path.join(__dirname,'../assets',f),'utf8');
const engine=asset('camera-decoder.js'), shortCodes=asset('code.js'), scanner=asset('scanner.js'), cameraPage=asset('camera-page.js');
function env({unique=false, native=true, page=false, nativeFails=false, decoderFails=false, autoCamera=false, decoded='ITM-ABCDEF'}={}) {
 const elements={};const windowHandlers={};let tracksStopped=0,videoRequested=0, decoderLoads=0, fallbackCalls=0, navCount=0;
 const callbacks=[];
 function element(id) {return elements[id] ||= {id,value:'',style:{},dataset:{},textContent:'',listeners:{},children:[],disabled:false,focus(){},addEventListener(name,fn){this.listeners[name]=fn;},appendChild(child){this.children.push(child);},submit(){this.submitCount=(this.submitCount||0)+1;}};}
 const form=element('qrr-bulk-selection');form.dataset.autoContinue=unique?'1':'0';form.dataset.autoCamera=autoCamera?'1':'0';form.submitCount=0;
 form.requestSubmit=()=>{let prevented=false;form.listeners.submit({preventDefault(){prevented=true;}});if(!prevented)form.submitCount++;};
 const video=element(page?'qrr-video':'qrr-camera-video');video.videoWidth=640;video.videoHeight=480;video.readyState=2;video.play=async()=>{};
 const ctx={drawImage(){},getImageData(_x,_y,width,height){return {data:new Uint8ClampedArray(width*height*4)};}};
 const document={getElementById:element,createElement(name){
   if(name==='canvas')return {width:0,height:0,getContext(){return ctx;},toDataURL(){return 'data:image/jpeg;base64,'+'QQ'.repeat(200);}};
   if(name==='script')return {onload:null,onerror:null};
   return {textContent:'',className:'',style:{}};
 },head:{appendChild(s){decoderLoads++;assert.match(s.src,/jsqr@1\.4\.0\/dist\/jsQR\.js$/);setImmediate(()=>{if(!decoderFails){win.jsQR=()=>{fallbackCalls++;return {data:decoded,location:{topLeftCorner:{x:10,y:20},topRightCorner:{x:100,y:20},bottomLeftCorner:{x:10,y:110},bottomRightCorner:{x:100,y:110}}};};s.onload();}else s.onerror();});}}};
 const win={addEventListener(type,listener){(windowHandlers[type]||=[]).push(listener);}};
 const sandbox={document,window:win,navigator:{mediaDevices:{async getUserMedia(){videoRequested++;return {getTracks(){return [{stop(){tracksStopped++;}}];}};}}},requestAnimationFrame:fn=>{callbacks.push(fn);return callbacks.length;},cancelAnimationFrame(){},Date,console,Uint8ClampedArray,Promise,setTimeout,clearTimeout};
 if(native)win.BarcodeDetector=class{constructor(){}async detect(){if(nativeFails)throw new Error('Native QR API failed');return [{rawValue:decoded,boundingBox:{x:20,y:20,width:150,height:150}}];}};
 for(const file of [engine,shortCodes,page?cameraPage:scanner])vm.runInNewContext(file,sandbox,{filename:page?'camera-page.js':'scanner.js'});
 return {element,form,video,callbacks,win,fire:async(type)=>{for(const fn of windowHandlers[type]||[])await fn();},run:async()=>{const fn=callbacks.shift();assert(fn,'scan frame requested');await fn();},counts:()=>({tracksStopped,videoRequested,decoderLoads,fallbackCalls,navCount})};
}
function scanKeyboard(e,id){const input=e.element('qrr-scan-input');input.value=id;let prevented=false;input.listeners.keydown({key:'Enter',preventDefault(){prevented=true;}});assert(prevented);}
(async()=>{
 let e=env({unique:true});scanKeyboard(e,'ITM-ABCDEF');
 assert.equal(e.form.submitCount,1,'unique scan submits immediately');
 assert.equal(e.element('qrr-scanned-codes').value,'ITM-ABCDEF');
 assert.equal(e.element('qrr-scan-thumbnail').value,'','hardware scan has no camera photo');
 e=env({unique:true});e.element('qrr-scan-input').value='ITM-ABCDGH';e.form.requestSubmit();
 assert.equal(e.form.submitCount,1,'manual Continue works');
 e=env();scanKeyboard(e,'ITM-ABCDEF');scanKeyboard(e,'ITM-ABCDGH');
 assert.equal(e.form.submitCount,0,'generic scans stay in selection');
 assert.equal(e.element('qrr-scanned-codes').value,'ITM-ABCDEF\nITM-ABCDGH');
 e=env({unique:true});await e.element('qrr-camera-toggle').listeners.click();await e.run();
 assert.equal(e.form.submitCount,1,'native QR scan opens details');
 assert.match(e.element('qrr-scan-thumbnail').value,/^data:image\/jpeg;base64,/);
 assert.equal(e.counts().decoderLoads,0,'native detection does not load fallback library');
 assert.equal(e.counts().tracksStopped,1,'camera tracks released after unique scan');
 e=env({unique:true,native:false});await e.element('qrr-camera-toggle').listeners.click();await new Promise(resolve=>setImmediate(resolve));await e.run();
 assert.equal(e.counts().decoderLoads,1,'Firefox loads jsQR exactly once');
 assert.equal(e.counts().fallbackCalls,1,'Firefox supplies image pixels to jsQR');
 assert.equal(e.form.submitCount,1,'Firefox scan opens details');
 assert.match(e.element('qrr-scan-thumbnail').value,/^data:image\/jpeg;base64,/,'Firefox also stores cropped photo');
 e=env({native:false});await e.element('qrr-camera-toggle').listeners.click();await new Promise(resolve=>setImmediate(resolve));await e.run();
 assert.equal(e.element('qrr-scanned-codes').value,'ITM-ABCDEF','Firefox generic scanning adds code');
 assert.equal(e.form.submitCount,0,'Firefox bulk scanning does not auto-submit');
 e=env({native:true,nativeFails:true});await e.element('qrr-camera-toggle').listeners.click();await e.run();await new Promise(resolve=>setImmediate(resolve));await e.run();
 assert.equal(e.counts().fallbackCalls,1,'native detector exception switches to software decoder');
 e=env({native:false,decoderFails:true});await e.element('qrr-camera-toggle').listeners.click();await new Promise(resolve=>setImmediate(resolve));
 assert.match(e.element('qrr-scan-status').textContent,/Cannot load QR decoder library/);
 assert.equal(e.counts().videoRequested,1,'request camera before starting optional decoder download');
 assert.equal(e.counts().tracksStopped,1,'close camera if software decoder cannot be loaded');
 e=env({autoCamera:true});await e.fire('load');await e.run();
 assert.equal(e.counts().videoRequested,1,'camera starts automatically on registration/bulk scan screens');
 assert.equal(e.element('qrr-scanned-codes').value,'ITM-ABCDEF','automatic camera records a scanned identifier');
 e=env({page:true,native:false});await e.fire('load');await new Promise(resolve=>setImmediate(resolve));await e.run();
 assert.equal(e.element('qrr-code').value,'ITM-ABCDEF','standalone camera receives QR');
 assert.equal(e.element('qrr-manual').submitCount,1,'standalone camera submits existing scan form');
 assert.equal(e.counts().videoRequested,1,'standalone scanner starts on load');
 assert.equal(e.counts().tracksStopped,1,'standalone camera stops on detection');
 const shortPayload='2H7KP';const alphabet='23456789ABCDEFGHJKMNPQRSTUVWXYZ';let state=0;for(const c of shortPayload)state=(state*3+alphabet.indexOf(c)+1)%31;const short=shortPayload+alphabet[state];
 e=env({unique:true,decoded:short});await e.element('qrr-camera-toggle').listeners.click();await e.run();
 assert.equal(e.element('qrr-scanned-codes').value,short,'native QR scanner accepts new six-character code');
 assert.equal(e.form.submitCount,1,'short QR uniquely registered on native scan');
 e=env({unique:true,native:false,decoded:short});await e.element('qrr-camera-toggle').listeners.click();await new Promise(resolve=>setImmediate(resolve));await e.run();
 assert.equal(e.element('qrr-scanned-codes').value,short,'Firefox software decoder accepts new six-character code');
 assert.equal(e.form.submitCount,1,'short QR submits from Firefox');
 console.log('Scanner: keyboard, unique auto-continue, native QR, Firefox jsQR, native failure, library failure, standalone camera: PASS');
})().catch(err=>{console.error(err);process.exit(1);});
