
import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceManager,BaseDeviceAdapter} from '../src/index.js';
test('registers adapters',()=>{
 const dm=new DeviceManager();
 class Dummy extends BaseDeviceAdapter{constructor(){super('kindle','Kindle',{upload:true});}}
 dm.register(new Dummy());
 assert.equal(dm.list().length,1);
 assert.equal(dm.get('kindle').capabilities.upload,true);
});
test('requires adapter id',()=>{
 const dm=new DeviceManager();
 assert.throws(()=>dm.register({}),/adapter.id/);
});
