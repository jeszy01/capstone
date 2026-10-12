import {calculatePayroll} from './payrollCalculator';
import {DEFAULT_RATES} from './payrollRules';
import {RUNS_KEY} from './payrollRuns';
import type {PayrollInput} from '../../types/domain';
import type {PayrollRun} from './payrollRuns';
import {read,write} from '../../utils/storage';

export const TEST_SAMPLE_RUN_ID='TEST-ONLY-WHT-2026-10';
export const TEST_SAMPLE_PERIOD={from:'2026-10-01',to:'2026-10-15'};
const sampleInput:PayrollInput={empId:'TEST-WHT-001',name:'TEST SAMPLE — NOT AN EMPLOYEE',dailyRate:3000,daysWorked:10,absentDays:0,lateMin:0,undertimeMin:0,otHours:2,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:2000,riceSubsidy:2500,otherEarnings:6000,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0,thirteenthMonthAndOtherBenefits:100000,taxExemptBenefits:500};

/** Opt-in only. The fixture is Rejected (not approvable/payable) and is never seeded automatically. */
export function addTestSamplePayrollRun():PayrollRun{
 const existing=read<PayrollRun[]>(RUNS_KEY,[]).find(run=>run.id===TEST_SAMPLE_RUN_ID);
 if(existing)return existing;
 const result=calculatePayroll(sampleInput,DEFAULT_RATES,[],{period:'semi-monthly',periodStart:TEST_SAMPLE_PERIOD.from,periodEnd:TEST_SAMPLE_PERIOD.to,finalPeriod:false});
 const run:PayrollRun={id:TEST_SAMPLE_RUN_ID,...TEST_SAMPLE_PERIOD,status:'Rejected',rows:[{position:'TEST DATA ONLY',rest:0,hmo:0,input:sampleInput,result}],totals:{gross:result.gross,deductions:result.deductions,net:result.net},preparedBy:'TEST SAMPLE — NOT FOR PAYMENT',createdAt:new Date().toISOString(),decidedBy:'TEST FIXTURE',decidedAt:new Date().toISOString()};
 write(RUNS_KEY,[...read<PayrollRun[]>(RUNS_KEY,[]),run]);return run;
}
export function removeTestSamplePayrollRun(){write(RUNS_KEY,read<PayrollRun[]>(RUNS_KEY,[]).filter(run=>run.id!==TEST_SAMPLE_RUN_ID));}
