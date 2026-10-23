import {beforeEach,describe,expect,it,vi} from 'vitest';
import {ALLOWANCE_POLICY_KEY,allowanceMatrix,loadAllowancePolicy,policyTotals,policyTypeFor} from '../features/compensation/allowancePolicy';
import {allowanceTreatment} from '../features/compensation/allowanceRules';
import type {BonusIncentive} from '../features/compensation/compensationState';

const allowance=(employeeId:string,allowanceType:string,amount:number,frequency:BonusIncentive['frequency']='Monthly',status:BonusIncentive['status']='Active',effectiveDate='2026-01-01'):BonusIncentive=>({id:`${employeeId}-${allowanceType}-${amount}`,employeeId,type:'Allowance',amount,effectiveDate,notes:'',status,createdAt:'',allowanceType,frequency,taxable:true,cutoffStart:'',cutoffEnd:''});

describe('allowance policy',()=>{
 beforeEach(()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
 });
 it('has the four policy allowances, with HR edits kept',()=>{
  expect(loadAllowancePolicy().map(type=>[type.code,type.name,type.taxTreatment])).toEqual([['ALW-TR','Transport Allowance','taxable'],['ALW-RC','Rice Allowance','rice'],['ALW-ML','Meal Allowance','taxable'],['ALW-CM','Communication Allowance','taxable']]);
  localStorage.setItem(ALLOWANCE_POLICY_KEY,JSON.stringify([{id:'transport',defaultAmount:4000,name:'Transport'}]));
  expect(loadAllowancePolicy()[0]).toMatchObject({id:'transport',name:'Transport',code:'ALW-TR',defaultAmount:4000});
 });
 it('matches allowance records to a policy allowance by name',()=>{
  expect(policyTypeFor('Transportation')?.id).toBe('transport');
  expect(policyTypeFor('Rice Subsidy')?.id).toBe('rice');
  expect(policyTypeFor('Mobile Load')?.id).toBe('communication');
  expect(policyTypeFor('Housing')).toBeUndefined();
  expect(allowanceTreatment('Rice Allowance',[])).toBe('rice');
 });
 it('builds monthly amounts per employee and each allowance share of the cost',()=>{
  const policy=loadAllowancePolicy();
  const matrix=allowanceMatrix([
   allowance('a','Transport Allowance',4000),allowance('a','Rice Allowance',1000,'Per Cutoff'),
   allowance('b','Transportation',2000),allowance('b','Meal Allowance',500,'Monthly','Inactive'),
   allowance('b','Communication Allowance',1000,'Monthly','Active','2026-12-01'),allowance('b','Housing',3000),
  ],policy,'2026-10-23',2);
  expect(matrix.get('a')).toEqual({transport:4000,rice:2000});
  expect(matrix.get('b')).toEqual({transport:2000});
  expect(policyTotals(matrix,policy)).toEqual([{id:'transport',employees:2,monthly:6000,share:75},{id:'rice',employees:1,monthly:2000,share:25},{id:'meal',employees:0,monthly:0,share:0},{id:'communication',employees:0,monthly:0,share:0}]);
 });
});
