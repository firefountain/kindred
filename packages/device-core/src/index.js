
export class DeviceManager{
  constructor(){this.adapters=new Map();}
  register(adapter){
    if(!adapter.id) throw new Error('adapter.id required');
    this.adapters.set(adapter.id,adapter);
    return adapter;
  }
  unregister(id){this.adapters.delete(id);}
  list(){return [...this.adapters.values()];}
  get(id){return this.adapters.get(id);}
}
export function createCapabilities(c={}){
 return {
  upload:!!c.upload,download:!!c.download,delete:!!c.delete,
  metadata:!!c.metadata,collections:!!c.collections,
  annotations:!!c.annotations,covers:!!c.covers,thumbnails:!!c.thumbnails
 };
}
export class BaseDeviceAdapter{
 constructor(id,name,capabilities={}){
   this.id=id;this.name=name;
   this.capabilities=createCapabilities(capabilities);
 }
 async discover(){return [];}
 async connect(){throw new Error('Not implemented');}
 async disconnect(){return true;}
 async scan(){return [];}
 async send(){throw new Error('Not implemented');}
 async remove(){throw new Error('Not implemented');}
}
