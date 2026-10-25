// HMO history entries (fix for "violates check constraint hmo_history_entity_type_check"): every HMO change writes a
// history type the database accepts, and a change and its history are saved in one transaction.
import {describe,expect,it} from 'vitest';
import {HMO_HISTORY_TYPES,hmoHistoryType} from '../../backend-render/hmoRules.js';
import {heldReply,transactions} from '../../backend-render/transaction.js';
import server from '../../backend-render/server.js?raw';

describe('HMO history types',()=>{
 it('match the hmo_history entity_type check constraint',()=>{
  const constraint=server.match(/entity_type text not null check \(entity_type in \(([^)]*)\)\)/)![1].split(',').map((item:string)=>item.trim().replace(/'/g,''));
  expect(HMO_HISTORY_TYPES).toEqual(constraint);
 });
 it('map every HMO resource that can change to an accepted, singular type',()=>{
  expect(['providers','plans','enrollments','dependents'].map(hmoHistoryType)).toEqual(['provider','plan','enrollment','dependent']);
  expect(()=>hmoHistoryType('history')).toThrow();
 });
 it('are accepted for every history entry the server writes',()=>{
  // Each call is hmoHistory('<type>', …) with a literal type, or hmoHistory(hmoHistoryType(resource), …).
  const calls=[...server.matchAll(/hmoHistory\(([^,]+),/g)].map(match=>match[1].trim()).filter(arg=>!arg.startsWith('entityType'));
  expect(calls.length).toBeGreaterThan(10);
  for(const arg of calls){
   if(arg.startsWith('hmoHistoryType('))continue;
   const literal=arg.match(/^'([a-z_]+)'$/);
   if(literal)expect(HMO_HISTORY_TYPES).toContain(literal[1]);
   // type: the Maxicare follow-up reminder, from a list of [table, 'enrollment' | 'dependent', row].
   else expect(arg).toMatch(/^(change\.entityType|hmoHistoryType\(resource\)|type)$/);
  }
 });
});

// A fake pool: records which connection each query ran on.
function fakePool(failOn?:string){
 const log:string[]=[];
 const client={query:async(sql:unknown)=>{const text=typeof sql==='string'?sql:(sql as {text:string}).text;log.push(`client:${text}`);if(failOn&&text===failOn)throw new Error('constraint');return {rows:[]}},release:()=>log.push('release')};
 return {log,pool:{query:async(sql:unknown)=>{log.push(`pool:${typeof sql==='string'?sql:(sql as {text:string}).text}`);return {rows:[]}},connect:async()=>client}};
}

describe('HMO changes are saved in one transaction',()=>{
 it('commits the change and its history together',async()=>{
  const {log,pool}=fakePool(),{db,inTransaction}=transactions(pool);
  await inTransaction(async()=>{await db().query('update enrollment');await db().query('insert history')});
  expect(log).toEqual(['client:begin','client:update enrollment','client:insert history','client:commit','release']);
 });
 it('rolls the change back when the history entry fails',async()=>{
  const {log,pool}=fakePool('insert history'),{db,inTransaction}=transactions(pool);
  await expect(inTransaction(async()=>{await db().query('update enrollment');await db().query('insert history')})).rejects.toThrow('constraint');
  expect(log).toEqual(['client:begin','client:update enrollment','client:insert history','client:rollback','release']);
 });
 it('uses the pool outside a transaction',async()=>{
  const {log,pool}=fakePool(),{db}=transactions(pool);
  await db().query('select plans');
  expect(log).toEqual(['pool:select plans']);
 });
 it('holds the reply until it is sent after the commit',()=>{
  const held=heldReply();
  held.res.status(409);held.res.json({error:'not pending'});
  expect(held.reply).toEqual({status:409,body:{error:'not pending'}});
 });
});
