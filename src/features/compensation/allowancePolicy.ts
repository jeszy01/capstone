import {read,write} from '../../utils/storage';
import type {DeMinimisCategory} from '../payroll/deMinimis';
import type {BonusIncentive} from './compensationState';

/** taxTreatment: 'taxable', or the de minimis benefit the allowance is (tax-free up to its BIR ceiling). */
export type PolicyTreatment='taxable'|DeMinimisCategory;
/** allEmployees: every active employee gets the type at defaultAmount a month; otherwise amounts are set per employee (Custom). */
export type PolicyType={id:string;name:string;code:string;taxTreatment:PolicyTreatment;defaultAmount:number;allEmployees?:boolean};
export const ALLOWANCE_POLICY_KEY='compensation:allowance-policy';

const DEFAULT_POLICY:PolicyType[]=[
 {id:'transport',name:'Transport Allowance',code:'ALW-TR',taxTreatment:'taxable',defaultAmount:0},
 {id:'rice',name:'Rice Allowance',code:'ALW-RC',taxTreatment:'rice',defaultAmount:0},
 {id:'meal',name:'Meal Allowance',code:'ALW-ML',taxTreatment:'taxable',defaultAmount:0},
 {id:'communication',name:'Communication Allowance',code:'ALW-CM',taxTreatment:'taxable',defaultAmount:0},
];
// Allowance records name their type; older records use other names (Transportation, Rice Subsidy, Phone...).
const KEYWORDS:Record<string,string[]>={transport:['transport'],rice:['rice'],meal:['meal','food'],communication:['communication','phone','mobile','internet']};

/** The four policy allowances with HR's saved edits. */
export function loadAllowancePolicy():PolicyType[]{
 const saved=read<Partial<PolicyType>[]>(ALLOWANCE_POLICY_KEY,[]);
 return DEFAULT_POLICY.map(type=>{const edit=Array.isArray(saved)?saved.find(item=>item?.id===type.id):undefined;return edit?{...type,...edit,id:type.id}:type});
}
export const saveAllowancePolicy=(policy:PolicyType[])=>write(ALLOWANCE_POLICY_KEY,policy);

/** The policy allowance an allowance record belongs to, by its type name; undefined when it matches none. */
export function policyTypeFor(allowanceType:string,policy:PolicyType[]=loadAllowancePolicy()){
 const name=allowanceType.trim().toLowerCase();
 if(!name)return undefined;
 return policy.find(type=>type.name.trim().toLowerCase()===name)??policy.find(type=>(KEYWORDS[type.id]??[]).some(word=>name.includes(word)));
}

/** Monthly amount of an allowance record: per-cutoff amounts times the pay periods in a month. */
export const monthlyAmount=(item:Pick<BonusIncentive,'amount'|'frequency'>,payPeriodsPerMonth:number)=>item.frequency==='Per Cutoff'?item.amount*payPeriodsPerMonth:item.amount;

/** Each employee's monthly amount per policy allowance from the allowances in effect on date. */
export function allowanceMatrix(rewards:BonusIncentive[],policy:PolicyType[],date:string,payPeriodsPerMonth:number){
 const matrix=new Map<string,Record<string,number>>();
 for(const item of rewards){
  if(item.type!=='Allowance'||item.status!=='Active'||item.effectiveDate>date)continue;
  const type=policyTypeFor(item.allowanceType,policy);
  if(!type)continue;
  const row=matrix.get(item.employeeId)??{};
  row[type.id]=Math.round(((row[type.id]??0)+monthlyAmount(item,payPeriodsPerMonth))*100)/100;
  matrix.set(item.employeeId,row);
 }
 return matrix;
}

/** Per policy allowance: employees receiving it, monthly cost and share of all allowance cost (percent, 1 decimal). */
export function policyTotals(matrix:Map<string,Record<string,number>>,policy:PolicyType[]){
 const rows=policy.map(type=>{
  const amounts=[...matrix.values()].map(row=>row[type.id]??0).filter(amount=>amount>0);
  return {id:type.id,employees:amounts.length,monthly:Math.round(amounts.reduce((sum,amount)=>sum+amount,0)*100)/100};
 });
 const total=rows.reduce((sum,row)=>sum+row.monthly,0);
 return rows.map(row=>({...row,share:total>0?Math.round(row.monthly/total*1000)/10:0}));
}
