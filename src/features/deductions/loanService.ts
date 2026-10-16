import {apiClient} from '../../services/api/apiClient';
import type {LoanApprovalStatus,LoanRecordType,RepaymentFrequency} from './loanCalculations';

export interface EmployeeLoan{
 id:string;employeeId:string;employeeNumber:string;employeeName:string;department:string;recordType:LoanRecordType;loanType:string;purpose:string;principalAmount:number;installmentCount:number;installmentAmount:number;repaymentFrequency:RepaymentFrequency;repaymentStartDate:string;releaseDate:string;approvalStatus:LoanApprovalStatus;approvedBy:string|null;approvedAt:string|null;rejectionReason:string|null;createdBy:string|null;createdAt:string;updatedAt:string;outstandingBalance:number;repaymentsCompleted:number;
}
export interface LoanTransaction{
 id:string;loanId:string;eventType:'Created'|'Approved'|'Rejected'|'Repayment';amount:number;note:string|null;actorId:string|null;payrollRunId:string|null;periodStart:string|null;periodEnd:string|null;createdAt:string;
}
export interface ScheduledLoanRepayment{
 loanId:string;employeeId:string;employeeNumber:string;employeeName:string;recordType:LoanRecordType;loanType:string;amount:number;installmentNumber:number;installmentCount:number;outstandingAfter:number;
}
export interface LoanWorkspace{loans:EmployeeLoan[];transactions:LoanTransaction[]}
export interface CreateLoanInput{employeeId:string;recordType:LoanRecordType;loanType:string;purpose:string;principalAmount:number;installmentCount:number;repaymentFrequency:RepaymentFrequency;repaymentStartDate:string;releaseDate:string}

type Envelope<T>={data:T};
type CreateLoanPayload={employee_id:string;record_type:LoanRecordType;loan_type:string;purpose:string;principal_amount:number;installment_count:number;repayment_frequency:RepaymentFrequency;repayment_start_date:string;release_date:string};
export const LOANS_ENABLED=false;
const disabled=()=>Promise.reject(new Error('Loans are temporarily disabled.'));
export const loanService={
 list:async():Promise<LoanWorkspace>=>LOANS_ENABLED?apiClient.get<Envelope<LoanWorkspace>>('/loans').then(response=>response.data):{loans:[],transactions:[]},
 schedule:async(periodStart:string,periodEnd:string):Promise<ScheduledLoanRepayment[]>=>LOANS_ENABLED?apiClient.get<Envelope<ScheduledLoanRepayment[]>>(`/loans/schedule?${new URLSearchParams({period_start:periodStart,period_end:periodEnd})}`).then(response=>response.data):[],
 create:async(input:CreateLoanInput):Promise<void>=>{if(!LOANS_ENABLED)return disabled();await apiClient.post<CreateLoanPayload,Envelope<unknown>>('/loans',{employee_id:input.employeeId,record_type:input.recordType,loan_type:input.loanType,purpose:input.purpose,principal_amount:input.principalAmount,installment_count:input.installmentCount,repayment_frequency:input.repaymentFrequency,repayment_start_date:input.repaymentStartDate,release_date:input.releaseDate})},
 approve:async(id:string):Promise<void>=>{if(!LOANS_ENABLED)return disabled();await apiClient.patch<{action:'approve'},Envelope<unknown>>(`/loans/${id}`,{action:'approve'})},
 reject:async(id:string,rejectionReason:string):Promise<void>=>{if(!LOANS_ENABLED)return disabled();await apiClient.patch<{action:'reject';rejection_reason:string},Envelope<unknown>>(`/loans/${id}`,{action:'reject',rejection_reason:rejectionReason})},
 /** Runs every settlement check for a paid payroll run without posting the repayment batch. */
 validatePaidPayrollRun:async(payrollRunId:string)=>LOANS_ENABLED?apiClient.post<{payroll_run_id:string;validate_only:true},Envelope<{valid:boolean;count:number;totalAmount:number}>>('/loans/settle',{payroll_run_id:payrollRunId,validate_only:true}).then(response=>response.data):{valid:true,count:0,totalAmount:0},
 postPaidPayrollRun:async(payrollRunId:string)=>LOANS_ENABLED?apiClient.post<{payroll_run_id:string},Envelope<{posted:boolean;count:number;totalAmount:number;idempotent?:boolean}>>('/loans/settle',{payroll_run_id:payrollRunId}).then(response=>response.data):{posted:true,count:0,totalAmount:0,idempotent:true},
};
