import {read,write} from '../../utils/storage';

/** One regional wage order: the daily minimum wage from effectiveFrom until the next order. */
export interface MinimumWageOrder{effectiveFrom:string;dailyRate:number;wageOrder:string}
export const MINIMUM_WAGES_KEY='payroll:minimum-wages';
/**
 * NCR non-agriculture rates from the NWPC (nwpc.dole.gov.ph/regionandwages/ncr). Wage Order NCR-27 is left out: the
 * NWPC lists it as awaiting resolution by two Regional Trial Courts, and NCR-28 replaced its first tranche.
 */
export const DEFAULT_MINIMUM_WAGES:MinimumWageOrder[]=[
 {effectiveFrom:'2025-07-18',dailyRate:695,wageOrder:'Wage Order NCR-26'},
 {effectiveFrom:'2026-09-26',dailyRate:755,wageOrder:'Wage Order NCR-28'},
];
/**
 * The saved wage orders. Before any are saved: a minimum wage the company entered in the single setting used before
 * wage orders (not an NCR default, 695 or 755) is kept for every date, so another region's rate is never replaced by NCR's.
 */
export const loadMinimumWages=():MinimumWageOrder[]=>{
 const saved=read<MinimumWageOrder[]>(MINIMUM_WAGES_KEY,[]);
 if(Array.isArray(saved)&&saved.length)return [...saved].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
 const single=Number(read<{statutoryMinimumWage?:number}>('payroll:rates',{}).statutoryMinimumWage);
 if(single>0&&!DEFAULT_MINIMUM_WAGES.some(order=>order.dailyRate===single))return [{effectiveFrom:'2000-01-01',dailyRate:single,wageOrder:'Minimum wage set before wage orders'}];
 return [...DEFAULT_MINIMUM_WAGES];
};
export const saveMinimumWages=(orders:MinimumWageOrder[])=>write(MINIMUM_WAGES_KEY,[...orders].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)));
export function validateMinimumWages(orders:MinimumWageOrder[]){
 const errors:string[]=[];
 if(!orders.length)errors.push('Add at least one wage order.');
 orders.forEach((order,index)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(order.effectiveFrom))errors.push(`Wage order ${index+1}: enter the effective date.`);
  if(!(order.dailyRate>0))errors.push(`Wage order ${index+1}: enter the daily minimum wage.`);
  if(!order.wageOrder.trim())errors.push(`Wage order ${index+1}: enter the wage order number.`);
 });
 if(new Set(orders.map(order=>order.effectiveFrom)).size!==orders.length)errors.push('Two wage orders cannot start on the same day.');
 return errors;
}
/** The wage order in effect on date, or undefined before the first one. */
export const wageOrderOn=(date:string,orders=loadMinimumWages())=>[...orders].sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)).find(order=>order.effectiveFrom<=date);
/**
 * The minimum wage for a cutoff from..to: the highest rate in effect on any day of it, so an employee still paid the
 * old minimum in a cutoff where a new wage order starts remains a minimum wage earner. 0 when no order applies.
 */
export function minimumWageFor(from:string,to:string,orders=loadMinimumWages()){
 const rates=[wageOrderOn(from,orders),...orders.filter(order=>order.effectiveFrom>from&&order.effectiveFrom<=to)].map(order=>order?.dailyRate??0);
 return Math.max(0,...rates);
}
