import {apiClient} from '../../services/api/apiClient';

export type GovernmentLoanType='SSS'|'Pag-IBIG';
export type GovernmentLoanStatus='Pending'|'Active'|'Rejected'|'Closed';
export interface GovernmentLoan{
 id:string;employeeId:string;employeeNumber:string;employeeName:string;department:string;loanType:GovernmentLoanType;referenceNo:string;totalAmount:number;monthlyAmortization:number;startDate:string;
 outstandingBalance:number;status:GovernmentLoanStatus;noticeName:string;remarks:string;rejectionRemarks:string|null;verifiedBy:string|null;verifiedAt:string|null;rejectedAt:string|null;closedAt:string|null;
 createdBy:string|null;createdAt:string;updatedAt:string;
}
export interface GovernmentLoanTransaction{id:string;loanId:string;payrollRunId:string;periodStart:string;periodEnd:string;amount:number;balanceAfter:number;postedBy:string|null;createdAt:string}
/** An Active loan payroll may deduct in a cutoff (start date on or before the cutoff end, balance above zero). */
export interface ScheduledGovernmentLoan{loanId:string;employeeId:string;employeeNumber:string;employeeName:string;loanType:GovernmentLoanType;referenceNo:string;monthlyAmortization:number;outstandingBalance:number}
export interface GovernmentLoanNotice{name:string;data:string}
export interface GovernmentLoanInput{employeeId:string;loanType:GovernmentLoanType;referenceNo:string;totalAmount:number;monthlyAmortization:number;startDate:string;remarks:string;notice?:GovernmentLoanNotice}

type Envelope<T>={data:T};
const payload=(input:GovernmentLoanInput)=>({employee_id:input.employeeId,loan_type:input.loanType,reference_no:input.referenceNo,total_amount:input.totalAmount,monthly_amortization:input.monthlyAmortization,start_date:input.startDate,remarks:input.remarks,
 ...(input.notice?{notice_name:input.notice.name,notice_data:input.notice.data}:{})});
const patch=(id:string,body:Record<string,unknown>)=>apiClient.patch<Record<string,unknown>,Envelope<GovernmentLoan>>(`/government-loans/${id}`,body).then(response=>response.data);

export const governmentLoanService={
 list:()=>apiClient.get<Envelope<{loans:GovernmentLoan[];transactions:GovernmentLoanTransaction[]}>>('/government-loans').then(response=>response.data),
 schedule:(periodStart:string,periodEnd:string)=>apiClient.get<Envelope<ScheduledGovernmentLoan[]>>(`/government-loans/schedule?${new URLSearchParams({period_start:periodStart,period_end:periodEnd})}`).then(response=>response.data),
 notice:(id:string)=>apiClient.get<Envelope<GovernmentLoanNotice>>(`/government-loans/${id}/notice`).then(response=>response.data),
 create:(input:GovernmentLoanInput)=>apiClient.post<ReturnType<typeof payload>,Envelope<GovernmentLoan>>('/government-loans',payload(input)).then(response=>response.data),
 update:(id:string,input:GovernmentLoanInput)=>patch(id,{action:'update',...payload(input)}),
 verify:(id:string)=>patch(id,{action:'verify'}),
 reject:(id:string,remarks:string)=>patch(id,{action:'reject',remarks}),
 /** Runs every settlement check for a released payroll run without changing any balance. */
 validateSettlement:(payrollRunId:string)=>apiClient.post<{payroll_run_id:string;validate_only:true},Envelope<{valid:boolean;count:number;totalAmount:number}>>('/government-loans/settle',{payroll_run_id:payrollRunId,validate_only:true}).then(response=>response.data),
 /** Posts a released payroll run's government loan deductions; safe to repeat for the same run. */
 settle:(payrollRunId:string)=>apiClient.post<{payroll_run_id:string},Envelope<{posted:boolean;count:number;totalAmount:number;idempotent:boolean}>>('/government-loans/settle',{payroll_run_id:payrollRunId}).then(response=>response.data),
};
