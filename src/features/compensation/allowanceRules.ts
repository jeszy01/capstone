import {read,write} from '../../utils/storage';
import {loadWithholdingRules,ruleForDate,saveWithholdingRules} from '../payroll/withholdingTax';
import type {DeMinimisCap,WithholdingTaxRuleSet} from '../payroll/withholdingTax';
import type {BonusIncentive} from './compensationState';

// Each allowance type may be linked to a de minimis ceiling of the effective withholding rules (Payroll Settings).
export interface AllowanceType{id:string;name:string;deMinimisCapId:string}
export const ALLOWANCE_TYPES_KEY='compensation:allowance-types';
export const DEFAULT_ALLOWANCE_TYPES:AllowanceType[]=[
 {id:'transportation',name:'Transportation',deMinimisCapId:''},
 {id:'rice-subsidy',name:'Rice Subsidy',deMinimisCapId:'rice-subsidy'},
 {id:'meal',name:'Meal',deMinimisCapId:''},
 {id:'communication',name:'Communication',deMinimisCapId:''},
 {id:'clothing',name:'Clothing',deMinimisCapId:'uniform-clothing'},
 {id:'medical',name:'Medical',deMinimisCapId:'actual-medical-assistance'},
 {id:'laundry',name:'Laundry',deMinimisCapId:'laundry'},
 {id:'housing',name:'Housing',deMinimisCapId:''},
];
export const loadAllowanceTypes=():AllowanceType[]=>read<AllowanceType[]|null>(ALLOWANCE_TYPES_KEY,null)??DEFAULT_ALLOWANCE_TYPES;
export const saveAllowanceTypes=(types:AllowanceType[])=>write(ALLOWANCE_TYPES_KEY,types);

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const CAP_MONTHS:Partial<Record<DeMinimisCap['unit'],number>>={monthly:1,'semi-annual':6,annual:12};
const today=()=>new Date().toISOString().slice(0,10);

/** Ceilings that can be expressed per month and therefore compared with an allowance amount. */
export const linkableCaps=(rule:WithholdingTaxRuleSet)=>rule.deMinimisCaps.filter(cap=>CAP_MONTHS[cap.unit]!==undefined);
export const monthlyCap=(cap?:DeMinimisCap)=>{const months=cap?CAP_MONTHS[cap.unit]:undefined;return cap&&months?cap.amount/months:undefined};
export const monthlyAmount=(allowance:Pick<BonusIncentive,'amount'|'frequency'>,payPeriodsPerMonth:number)=>allowance.frequency==='Per Cutoff'?allowance.amount*payPeriodsPerMonth:allowance.amount;
const sameName=(left:string,right:string)=>left.trim().toLowerCase()===right.trim().toLowerCase();
export const findAllowanceType=(types:AllowanceType[],name:string)=>types.find(type=>sameName(type.name,name));
/** Monthly de minimis limit for an allowance type, or undefined when the type is fully taxable. */
export function allowanceLimit(name:string,types:AllowanceType[],rule:WithholdingTaxRuleSet){
 const capId=findAllowanceType(types,name)?.deMinimisCapId;
 return capId?monthlyCap(rule.deMinimisCaps.find(cap=>cap.id===capId)):undefined;
}

/** Active allowances of the same employee and type are totalled monthly; a total above the limit is taxable. */
export function allowanceTaxability(allowances:BonusIncentive[],types:AllowanceType[],rule:WithholdingTaxRuleSet,payPeriodsPerMonth:number){
 const key=(item:BonusIncentive)=>`${item.employeeId}|${item.allowanceType.trim().toLowerCase()}`;
 const totals=new Map<string,number>();
 for(const item of allowances)if(item.status==='Active')totals.set(key(item),(totals.get(key(item))??0)+monthlyAmount(item,payPeriodsPerMonth));
 const taxable=new Map<string,boolean>();
 for(const item of allowances){
  const limit=allowanceLimit(item.allowanceType,types,rule);
  const total=item.status==='Active'?totals.get(key(item))??0:monthlyAmount(item,payPeriodsPerMonth);
  taxable.set(item.id,limit===undefined||total>limit+0.005);
 }
 return taxable;
}

/** Allowances active for an employee on a date. */
export const activeAllowances=(rewards:BonusIncentive[],employeeIds:string[],date:string)=>rewards.filter(item=>item.type==='Allowance'&&item.status==='Active'&&item.effectiveDate<=date&&employeeIds.includes(item.employeeId));

/** Allowance pay for one cutoff, split into the de minimis exempt portion and the taxable excess. */
export function allowancePay(allowances:BonusIncentive[],types:AllowanceType[],rule:WithholdingTaxRuleSet,payPeriodsPerMonth:number){
 const byType=new Map<string,number>();
 for(const item of allowances){const name=item.allowanceType.trim().toLowerCase();byType.set(name,(byType.get(name)??0)+monthlyAmount(item,payPeriodsPerMonth)/payPeriodsPerMonth)}
 let taxable=0,exempt=0;
 for(const [name,perCutoff] of byType){
  const limit=allowanceLimit(name,types,rule);
  const free=limit===undefined?0:Math.min(perCutoff,limit/payPeriodsPerMonth);
  exempt+=free;taxable+=perCutoff-free;
 }
 return {taxable:round(taxable),exempt:round(exempt)};
}

/** De minimis ceilings are edited on the withholding rule set in effect today. */
export function saveDeMinimisLimits(amounts:Record<string,number>){
 const rules=loadWithholdingRules();const current=ruleForDate(today(),rules);
 saveWithholdingRules(rules.map(rule=>rule.id===current.id?{...rule,deMinimisCaps:rule.deMinimisCaps.map(cap=>cap.id in amounts?{...cap,amount:amounts[cap.id]}:cap)}:rule));
}
