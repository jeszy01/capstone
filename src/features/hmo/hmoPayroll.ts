import type {HmoPayrollDeduction} from './hmoTypes';

/** Sum only verified HMO deductions assigned to this exact payroll cutoff. */
export function verifiedHmoDeductionTotal(items:HmoPayrollDeduction[],employeeId:string,periodStart:string,periodEnd:string):number{
 if(!employeeId||!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodEnd<periodStart)throw new Error('A valid employee and payroll period are required to calculate HMO deductions.');
 const amount=items.filter(item=>item.employeeId===employeeId&&item.periodStart===periodStart&&item.periodEnd===periodEnd&&item.verificationStatus==='Verified').reduce((sum,item)=>sum+Number(item.amount||0),0);
 return Math.round((amount+Number.EPSILON)*100)/100;
}
