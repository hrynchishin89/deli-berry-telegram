import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const api=existsSync(new URL('../shared/submit.mjs',import.meta.url))?await import('../shared/submit.mjs'):{};
const receipt={ok:true,delivered:true,orderId:'DB5-ABC',total:4080};

test('HTTP submission includes signed initData and returns only a delivery receipt',async()=>{
 assert.equal(typeof api.submitOrder,'function','HTTP submit adapter must exist');
 let received;
 const result=await api.submitOrder({requestId:'same-id'},'signed-session',async(url,options)=>{
  received={url,options};return {ok:true,json:async()=>receipt};
 });
 assert.deepEqual(result,receipt);assert.equal(received.url,'/api/catalog-v5/orders');
 assert.deepEqual(JSON.parse(received.options.body),{requestId:'same-id',initData:'signed-session'});
 assert.equal(received.options.method,'POST');
});

test('retrying an unchanged checkout reuses its request ID across close or reload',()=>{
 assert.equal(typeof api.reuseRequest,'function','retry identity helper must exist');
 const data={version:'v5',items:[{quantity:2}],point:'discovery',date:'2030-10-05',time:'15:00',comment:''};
 const previous={...data,requestId:'original-request'};
 assert.equal(api.reuseRequest(data,JSON.stringify(previous),'new-id').requestId,'original-request');
 assert.equal(api.reuseRequest({...data,point:'zelenopark'},JSON.stringify(previous),'new-id').requestId,'new-id');
 assert.equal(api.reuseRequest(data,'bad JSON','new-id').requestId,'new-id');
});

test('no success on missing session, rejected delivery, HTML error or network failure',async()=>{
 assert.equal(typeof api.submitOrder,'function','HTTP submit adapter must exist');
 await assert.rejects(()=>api.submitOrder({},'',async()=>{throw new Error('must not send');}),/Telegram/);
 await assert.rejects(()=>api.submitOrder({},'session',async()=>({ok:false,json:async()=>({error:'Передача не подтверждена'})})),/Передача не подтверждена/);
 await assert.rejects(()=>api.submitOrder({},'session',async()=>({ok:true,json:async()=>({ok:true,orderId:'DB5-ABC',delivered:false})})),/не подтверждена/);
 await assert.rejects(()=>api.submitOrder({},'session',async()=>({ok:false,json:async()=>{throw new Error('HTML');}})),/Повторите/);
 await assert.rejects(()=>api.submitOrder({},'session',async()=>{throw new Error('sensitive network details');}),/Проверьте соединение/);
});

test('HTTP body stall is aborted so checkout can return to retry state',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal,entered;const reading=new Promise(resolve=>{entered=resolve;});
 const submission=api.submitOrder({},'session',async(_url,options)=>{
  signal=options.signal;return {ok:true,json:()=>new Promise((_resolve,reject)=>{entered();signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})};
 });
 submission.catch(()=>{});
 await reading;t.mock.timers.tick(25001);
 assert.equal(signal.aborted,true,'deadline must cover the response body');
 await assert.rejects(submission,/Повторите/);
});
