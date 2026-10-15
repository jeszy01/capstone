import {read,write} from '../../utils/storage';
import type {BonusIncentive} from './compensationState';

export interface AllowanceType{id:string;name:string}
export const ALLOWANCE_TYPES_KEY='compensation:allowance-types';
const DEFAULT_ALLOWANCE_TYPES:AllowanceType[]=['Transportation','Rice Subsidy','Meal','Communication','Clothing','Medical','Laundry','Housing'].map(name=>({id:name.toLowerCase().replace(/\s+/g,'-'),name}));
// Allowance types saved before de minimis ceilings were removed carry a ceiling link; keep only id and name.
export const loadAllowanceTypes=():AllowanceType[]=>{
 const saved=read<Array<AllowanceType&{deMinimisCapId?:string}>|null>(ALLOWANCE_TYPES_KEY,null);
 if(!saved)return DEFAULT_ALLOWANCE_TYPES;
 if(saved.some(type=>'deMinimisCapId' in type)){const cleaned=saved.map(({id,name})=>({id,name}));write(ALLOWANCE_TYPES_KEY,cleaned);return cleaned}
 return saved;
};
export const saveAllowanceTypes=(types:AllowanceType[])=>write(ALLOWANCE_TYPES_KEY,types);

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

/** Allowances active for an employee on a date. */
export const activeAllowances=(rewards:BonusIncentive[],employeeIds:string[],date:string)=>rewards.filter(item=>item.type==='Allowance'&&item.status==='Active'&&item.effectiveDate<=date&&employeeIds.includes(item.employeeId));

/** Allowance pay for one cutoff, split by each allowance's Taxable choice. Monthly amounts are spread across the pay periods. */
export function allowancePay(allowances:BonusIncentive[],payPeriodsPerMonth:number){
 let taxable=0,exempt=0;
 for(const item of allowances){
  const perCutoff=item.frequency==='Per Cutoff'?item.amount:item.amount/payPeriodsPerMonth;
  if(item.taxable)taxable+=perCutoff;else exempt+=perCutoff;
 }
 return {taxable:round(taxable),exempt:round(exempt)};
}
