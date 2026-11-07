(function(){'use strict';
const tr = s => (typeof window !== 'undefined' && window.QRR_UI?.[s]) || s;
const script=document.currentScript;
const form=document.getElementById('qrr-manage')||document.getElementById('qrr-bulk');if(!form)return;
const type=form.querySelector('#qrr-type'),search=form.querySelector('#qrr-product-search'),productId=form.querySelector('#qrr-product-id');
const products=form.querySelector('#qrr-product-results'),status=form.querySelector('#qrr-product-status');
const warehouse=form.querySelector('#qrr-warehouse'),levels=form.querySelector('#qrr-levels');
const productUrl=script.dataset.productUrl,levelUrl=script.dataset.levelUrl;let timer=0,request=0;
function showType(){const t=type?type.value:'generic';form.querySelectorAll('.qrr-when-assigned').forEach(e=>e.style.display=(t==='unassigned'?'none':''));form.querySelectorAll('.qrr-when-box').forEach(e=>e.style.display=(t==='box'?'':'none'));form.querySelectorAll('.qrr-when-tracked').forEach(e=>e.style.display=(t==='tracked'?'':'none'));}
if(type){type.addEventListener('change',showType);showType();}
if(search&&productId&&products){
    function hide(){products.hidden=true;products.replaceChildren();}
    async function query(){const q=search.value.trim();const ticket=++request;try{
        const url=new URL(productUrl,location.href);url.searchParams.set('q',q);
        const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)throw new Error('Product search unavailable');const data=await r.json();if(ticket!==request)return;
        if(!Array.isArray(data))throw new Error('Invalid product lookup response');
        hide();for(const p of data){const option=document.createElement('button');option.type='button';option.className='qrr-lookup-option';option.setAttribute('role','option');option.textContent=p.text;option.addEventListener('click',()=>{productId.value=String(p.id);search.value=p.text;hide();status.textContent=tr('Selected product: ')+p.text;});products.appendChild(option);}
        products.hidden=data.length===0;status.textContent=data.length?data.length+tr(' product(s). Scroll to select one.'):tr('No matching products');
    }catch(e){if(ticket===request){hide();status.textContent=e.message;}}}
    search.addEventListener('focus',()=>{clearTimeout(timer);timer=setTimeout(query,100);});
    search.addEventListener('input',()=>{productId.value='0';++request;clearTimeout(timer);hide();timer=setTimeout(query,200);});
    const clear=form.querySelector('#qrr-clear-product');if(clear)clear.onclick=()=>{++request;clearTimeout(timer);search.value='';productId.value='0';hide();status.textContent=tr('No product assigned');};
    form.addEventListener('submit',e=>{if((type&&type.value==='unassigned')||(form.id==='qrr-bulk'&&form.querySelector('#qrr-bulk-mode').value==='blank'))return;if(search.value.trim() && !Number(productId.value)){e.preventDefault();alert(tr('Choose a product from the scrollable results or clear your search.'));}});
}
if(warehouse&&levels){warehouse.addEventListener('change',async()=>{levels.textContent=tr('Loading Binloc levels...');try{const url=new URL(levelUrl,location.href);url.searchParams.set('warehouse_id',warehouse.value);const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)throw new Error(await r.text());levels.innerHTML=await r.text();}catch(e){levels.textContent=tr('Unable to load Binloc levels: ')+e.message;}});}
})();
