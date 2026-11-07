/* Browser parity with the PHP-generated check character and legacy support. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/code.js'),'utf8'),{window});
const api=window.QRRCode;
const alphabet='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
for(const payload of ['23456','ZZZZZ','AAAAA','2H7KP']) {
  const check=api.check(payload),code=payload+check;
  assert.equal(check.length,1);assert.equal(api.valid(code),true);
  assert.equal(api.normalize(code.toLowerCase()),code);
  for(let i=0;i<6;i++)for(const replacement of alphabet) {
    if(replacement===code[i])continue;
    const edited=code.slice(0,i)+replacement+code.slice(i+1);
    assert.equal(api.valid(edited),false,`undetected mutation ${code} => ${edited}`);
  }
}
for(const old of ['ITM-ABCDEF','GEN-ABCDEF','BOX-ABCDEF','QR-ABCDEF','ABCDEFGHJK']) assert.equal(api.valid(old),true);
for(const invalid of ['000000','111111','ABCDEF','123','23456I']) assert.equal(api.valid(invalid),false);
console.log('Short QR browser check character and legacy validator: PASS');
