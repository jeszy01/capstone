import type {PayrollInput,PayrollRates,PayrollResult} from '../../types/domain'; import {numberValue} from '../../utils/storage';
import type {TaxBracket} from '../settings/payrollSettings';
const round=(v:number)=>Math.round(v*100)/100; const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

export function computeTax(monthlyTaxable:number,table:TaxBracket[]):number{
  const b=[...table].sort((a,c)=>c.over-a.over).find(x=>monthlyTaxable>x.over);
  return b?round(b.base+b.rate/100*(monthlyTaxable-b.over)):0;
}

export function calculatePayroll(r:PayrollInput,R:PayrollRates,brackets:TaxBracket[]=[]):PayrollResult{
  const rate=numberValue(r.dailyRate), hourly=rate/R.hoursPerDay, monthly=rate*R.daysPerMonth;

  const earnedBasic=round(rate*numberValue(r.daysWorked));
  const absences=round(rate*numberValue(r.absentDays));
  const basic=round(earnedBasic+absences);

  const overtime=round(hourly*(R.otMultiplier*numberValue(r.otHours)+R.otRestMultiplier*numberValue(r.otRestHours)));
  const leavePay=round(rate*(numberValue(r.vlDays)+numberValue(r.slDays)));
  const allowances=round(numberValue(r.transportation)+numberValue(r.riceSubsidy));
  const earnings=round(overtime+leavePay+numberValue(r.holidayPay)+numberValue(r.slConversion)+allowances+numberValue(r.otherEarnings));
  const gross=round(basic+earnings);

  const late=round(hourly/60*numberValue(r.lateMin));
  const undertime=round(hourly/60*numberValue(r.undertimeMin));

  const has=rate>0 && round(gross-absences)>0;

  const sss=has?round(clamp(Math.round(monthly/R.sssStep)*R.sssStep,R.sssMin,R.sssMax)*R.sssRate/100/R.payPeriodsPerMonth):0;
  const phil=has?round(clamp(monthly,R.philMin,R.philMax)*R.philRate/100/R.payPeriodsPerMonth):0;
  const pagibig=has?round(Math.min(monthly,R.pagibigMax)*R.pagibigRate/100/R.payPeriodsPerMonth):0;

  const P=R.payPeriodsPerMonth||1;
  const taxable=Math.max(0,gross-absences-late-undertime-allowances-sss-phil-pagibig);
  const manualTax=numberValue(r.withholdingTax);
  const tax=manualTax>0?manualTax:round(computeTax(taxable*P,brackets)/P);

  const loans=round(numberValue(r.sssLoan)+numberValue(r.pagibigLoan)+numberValue(r.companyLoan)+numberValue(r.cashAdvance));
  const deductions=round(absences+late+undertime+sss+phil+pagibig+tax+loans+numberValue(r.otherDeductions));
  const net=round(gross-deductions);

  return{basic,earnedBasic,absences,overtime,leavePay,allowances,earnings,gross,late,undertime,
    lateUt:round(late+undertime),sss,phil,pagibig,tax,loans,deductions,net,
    shortfall:net<0?round(-net):0};
}