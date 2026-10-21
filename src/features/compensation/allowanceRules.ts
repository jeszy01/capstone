import {read,write} from '../../utils/storage';
import {can} from '../auth/permissions';
import type {BonusIncentive} from './compensationState';
import {deMinimisCategory,deMinimisCutoffCeiling} from '../payroll/deMinimis';
import type {DeMinimisCategory} from '../payroll/deMinimis';

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
/** The tax treatment of an allowance type: as set in Allowance Types, otherwise suggested from its name. */
export const allowanceTreatment=(typeName:string,types:AllowanceType[]=loadAllowanceTypes()):AllowanceTaxTreatment=>
 types.find(type=>type.name.trim().toLowerCase()===typeName.trim().toLowerCase())?.taxTreatment??deMinimisCategory(typeName)??'taxable';

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

/** Allowances active for an employee on a date. */
export const activeAllowances=(rewards:BonusIncentive[],employeeIds:string[],date:string)=>rewards.filter(item=>item.type==='Allowance'&&item.status==='Active'&&item.effectiveDate<=date&&employeeIds.includes(item.employeeId));

/**
 * Allowance pay for one cutoff ending on date. Monthly amounts are spread across the pay periods.
 * - taxable: allowances marked taxable, and non-taxable ones whose type is set as taxable in Allowance Types (a fixed
 *   allowance is compensation subject to withholding, RR 2-98 Sec. 2.78.1(A)(6));
 * - exempt: de minimis allowances up to the BIR ceiling for the cutoff (RR 29-2025 from January 6, 2026);
 * - otherBenefits: the part above a ceiling, which counts toward the ₱90,000 13th month and other benefits exemption.
 */
export function allowancePay(allowances:BonusIncentive[],payPeriodsPerMonth:number,date=new Date().toISOString().slice(0,10),types:AllowanceType[]=loadAllowanceTypes()){
 let taxable=0,exempt=0,otherBenefits=0;
 const deMinimis=new Map<DeMinimisCategory,number>();
 for(const item of allowances){
  const perCutoff=item.frequency==='Per Cutoff'?item.amount:item.amount/payPeriodsPerMonth;
  const treatment=item.taxable?'taxable':allowanceTreatment(item.allowanceType??'',types);
  const category=treatment==='taxable'?null:treatment;
  if(category)deMinimis.set(category,(deMinimis.get(category)??0)+perCutoff);else taxable+=perCutoff;
 }
 for(const [category,amount] of deMinimis){
  const ceiling=deMinimisCutoffCeiling(category,date,payPeriodsPerMonth);
  exempt+=Math.min(amount,ceiling);otherBenefits+=Math.max(0,amount-ceiling);
 }
 return {taxable:round(taxable),exempt:round(exempt),otherBenefits:round(otherBenefits)};
}
