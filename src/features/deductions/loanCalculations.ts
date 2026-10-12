export type LoanRecordType='Loan'|'Cash Advance';
export type RepaymentFrequency='Per Payroll'|'Monthly First Cutoff'|'Monthly Second Cutoff';
export type LoanApprovalStatus='Pending'|'Approved'|'Rejected';
export interface LoanTermsInput{recordType:LoanRecordType;loanType:string;purpose:string;principalAmount:number;installmentCount:number;repaymentFrequency:RepaymentFrequency;releaseDate:string;repaymentStartDate:string}
export const roundMoney=(amount:number)=>Math.round((amount+Number.EPSILON)*100)/100;
export function calculateInstallmentAmount(principalAmount:number,installmentCount:number):number{
 if(!Number.isFinite(principalAmount)||principalAmount<=0||!Number.isInteger(installmentCount)||installmentCount<1)return 0;
 return roundMoney(Math.ceil(principalAmount/installmentCount*100-1e-8)/100);
}
export function amountDueForInstallment(principalAmount:number,installmentCount:number,paidInstallments:number,outstandingAmount:number):number{
 if(paidInstallments<0||paidInstallments>=installmentCount||outstandingAmount<=0)return 0;
 return roundMoney(Math.min(calculateInstallmentAmount(principalAmount,installmentCount),outstandingAmount));
}
export function isRepaymentPeriod(frequency:RepaymentFrequency,repaymentStartDate:string,periodStart:string,periodEnd:string):boolean{
 if(periodStart>periodEnd||periodEnd<repaymentStartDate)return false;
 if(frequency==='Per Payroll')return true;
 const day=Number(periodStart.slice(8,10));
 return frequency==='Monthly First Cutoff'?day===1:day>=16;
}
export function validateLoanTerms(input:LoanTermsInput):string[]{
 const errors:string[]=[];
 if(!input.loanType.trim())errors.push('Select a loan or advance type.');
 if(input.purpose.trim().length<3)errors.push('Enter a purpose of at least 3 characters.');
 if(!Number.isFinite(input.principalAmount)||input.principalAmount<=0)errors.push('Amount must be greater than zero.');
 if(!Number.isInteger(input.installmentCount)||input.installmentCount<1||input.installmentCount>1000)errors.push('Installment count must be a whole number between 1 and 1,000.');
 const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
 if(!validDate(input.releaseDate))errors.push('Enter a valid release date.');
 if(!validDate(input.repaymentStartDate))errors.push('Enter a valid first repayment date.');
 if(validDate(input.releaseDate)&&validDate(input.repaymentStartDate)&&input.repaymentStartDate<input.releaseDate)errors.push('The first repayment date cannot be before the release date.');
 if(!['Per Payroll','Monthly First Cutoff','Monthly Second Cutoff'].includes(input.repaymentFrequency))errors.push('Select a valid repayment schedule.');
 return errors;
}
