import {read,write} from '../../utils/storage';

export type OtherDeductionType='Uniform'|'Damages or Loss'|'Union Dues'|'Cooperative'|'Other';
export const otherDeductionTypes:OtherDeductionType[]=['Uniform','Damages or Loss','Union Dues','Cooperative','Other'];
export type OtherDeductionStatus='Active'|'Stopped';
/** A deduction the employee authorized in writing, taken from each payroll cutoff from startDate until endDate or until stopped. */
export interface OtherDeduction{id:string;employeeId:string;deductionType:OtherDeductionType;description:string;amountPerCutoff:number;startDate:string;endDate:string|null;authorized:boolean;status:OtherDeductionStatus;createdAt:string;createdBy:string;stoppedAt?:string;stoppedBy?:string}

const KEY='deductions:other';
export const loadOtherDeductions=()=>read<OtherDeduction[]>(KEY,[]);
export const saveOtherDeductions=(items:OtherDeduction[])=>write(KEY,items);

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
/** Active deductions that apply to a cutoff: started on or before its end and not ended before its start. */
export const appliesToCutoff=(item:OtherDeduction,from:string,to:string)=>item.status==='Active'&&item.startDate<=to&&(!item.endDate||item.endDate>=from);
/** The other authorized deductions for one employee in a payroll cutoff (the register's Other Deductions column). */
export const otherDeductionsForCutoff=(items:OtherDeduction[],employeeId:string,from:string,to:string)=>round(items.filter(item=>item.employeeId===employeeId&&appliesToCutoff(item,from,to)).reduce((sum,item)=>sum+item.amountPerCutoff,0));
