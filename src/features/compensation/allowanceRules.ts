import {read,write} from '../../utils/storage';
import {can} from '../auth/permissions';
import type {BonusIncentive} from './compensationState';
import {deMinimisLimit} from '../payroll/deMinimis';
import type {DeMinimisCategory} from '../payroll/deMinimis';
import {loadAllowancePolicy} from './allowancePolicy';
import type {PolicyType} from './allowancePolicy';

/** taxTreatment: 'taxable' (a fixed allowance, taxed as regular pay) or the de minimis benefit the type is. */
export type AllowanceTaxTreatment='taxable'|DeMinimisCategory;
export interface AllowanceType{id:string;name:string;taxTreatment?:AllowanceTaxTreatment}
export const ALLOWANCE_TYPES_KEY='compensation:allowance-types';
const DEFAULT_ALLOWANCE_TYPES:AllowanceType[]=['Transportation','Rice Subsidy','Meal','Communication','Clothing','Medical','Laundry','Housing'].map(name=>({id:name.toLowerCase().replace(/\s+/g,'-'),name}));
// Allowance types saved before de minimis ceilings were removed carry a ceiling link; keep only id and name.
export const loadAllowanceTypes=():AllowanceType[]=>{
 const saved=read<Array<AllowanceType&{deMinimisCapId?:string}>|null>(ALLOWANCE_TYPES_KEY,null);
 if(!saved)return DEFAULT_ALLOWANCE_TYPES;
 if(saved.some(type=>'deMinimisCapId' in type)){const cleaned=saved.map(({id,name})=>({id,name}));if(can('compensation.manage'))write(ALLOWANCE_TYPES_KEY,cleaned);return cleaned}
 return saved;
};
export const saveAllowanceTypes=(types:AllowanceType[])=>write(ALLOWANCE_TYPES_KEY,types);
/**
 * The tax treatment set for an allowance type: in Allowance Types, or on the allowance policy type of that exact name.
 * null when none is set. A name alone ("Rice", "Medical") never makes an allowance tax-free.
 */
export function allowanceTreatment(typeName:string,types:AllowanceType[]=loadAllowanceTypes(),policy:PolicyType[]=loadAllowancePolicy()):AllowanceTaxTreatment|null{
 const name=typeName.trim().toLowerCase();
 return types.find(type=>type.name.trim().toLowerCase()===name)?.taxTreatment??policy.find(type=>type.name.trim().toLowerCase()===name)?.taxTreatment??null;
}
/** De minimis already exempted for the employee: in the calendar month the cutoff is paid, and in its tax year. */
export type DeMinimisUsed={month?:Partial<Record<DeMinimisCategory,number>>;year?:Partial<Record<DeMinimisCategory,number>>};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

/** Allowances active for an employee on a date. */
export const activeAllowances=(rewards:BonusIncentive[],employeeIds:string[],date:string)=>rewards.filter(item=>item.type==='Allowance'&&item.status==='Active'&&item.effectiveDate<=date&&employeeIds.includes(item.employeeId));

/**
 * Allowance pay for one cutoff ending on date. Monthly amounts are spread across the pay periods.
 * - taxable: allowances marked taxable, those whose type is set as taxable, and those whose type has no tax treatment
 *   set (listed in unclassified for HR). A fixed allowance is compensation subject to withholding (RR 11-2018 Step 1);
 * - exempt: de minimis allowances up to what is left of the BIR limit (RR 29-2025 from January 6, 2026): a monthly
 *   limit for the calendar month the cutoff is paid in, a yearly limit for its tax year, less used (already exempted);
 * - otherBenefits: the part above the limit, which counts toward the ₱90,000 13th month and other benefits exemption.
 * byCategory: the amount exempted per de minimis category, saved with the payroll row so later cutoffs know what is left.
 */
export function allowancePay(allowances:BonusIncentive[],payPeriodsPerMonth:number,date=new Date().toISOString().slice(0,10),types:AllowanceType[]=loadAllowanceTypes(),used:DeMinimisUsed={},policy:PolicyType[]=loadAllowancePolicy()){
 let taxable=0,exempt=0,otherBenefits=0;
 const deMinimis=new Map<DeMinimisCategory,number>(),byCategory:Partial<Record<DeMinimisCategory,number>>={},unclassified:string[]=[];
 for(const item of allowances){
  const perCutoff=item.frequency==='Per Cutoff'?item.amount:item.amount/payPeriodsPerMonth;
  const treatment=item.taxable?'taxable':allowanceTreatment(item.allowanceType??'',types,policy);
  if(!treatment&&!unclassified.includes(item.allowanceType))unclassified.push(item.allowanceType);
  if(treatment&&treatment!=='taxable')deMinimis.set(treatment,(deMinimis.get(treatment)??0)+perCutoff);else taxable+=perCutoff;
 }
 for(const [category,amount] of deMinimis){
  const limit=deMinimisLimit(category,date),already=(limit.per==='month'?used.month:used.year)?.[category]??0;
  const allowed=Math.min(amount,Math.max(0,limit.amount-already));
  exempt+=allowed;otherBenefits+=amount-allowed;
  if(allowed>0)byCategory[category]=round(allowed);
 }
 return {taxable:round(taxable),exempt:round(exempt),otherBenefits:round(otherBenefits),byCategory,unclassified};
}
