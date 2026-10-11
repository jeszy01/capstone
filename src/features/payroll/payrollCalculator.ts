import type {PayrollInput,PayrollRates,PayrollResult} from '../../types/domain'; import {numberValue} from '../../utils/storage';
const round=(v:number)=>Math.round(v*100)/100; const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));


export function calculatePayroll(r:PayrollInput,R:PayrollRates):PayrollResult{
    const rate=numberValue(r.dailyRate), hourly=rate/R.hoursPerDay, monthly=rate*R.daysPerMonth;

  // Basic: show the full amount first, then deduct absences
  const earnedBasic=round(rate*numberValue(r.daysWorked));
  const absences=round(rate*numberValue(r.absentDays));   // <-- check the real field name
  const basic=round(earnedBasic+absences);                 // full basic for the cutoff

  const overtime=round(hourly*(R.otMultiplier*numberValue(r.otHours)+R.otRestMultiplier*numberValue(r.otRestHours)));
  const leavePay=round(rate*(numberValue(r.vlDays)+numberValue(r.slDays)));
  const allowances=round(numberValue(r.transportation)+numberValue(r.riceSubsidy));
  const earnings=round(overtime+leavePay+numberValue(r.holidayPay)+numberValue(r.slConversion)+allowances+numberValue(r.otherEarnings));
  const gross=round(basic+earnings);

  const late=round(hourly/60*numberValue(r.lateMin));
  const undertime=round(hourly/60*numberValue(r.undertimeMin));

  // No contributions if nothing was actually earned this cutoff
  const has=rate>0 && round(gross-absences)>0;

  const sss=has?round(clamp(Math.round(monthly/R.sssStep)*R.sssStep,R.sssMin,R.sssMax)*R.sssRate/100/R.payPeriodsPerMonth):0;
  const phil=has?round(clamp(monthly,R.philMin,R.philMax)*R.philRate/100/R.payPeriodsPerMonth):0;
  const pagibig=has?round(Math.min(monthly,R.pagibigMax)*R.pagibigRate/100/R.payPeriodsPerMonth):0;
  const tax=numberValue(r.withholdingTax);
  const loans=round(numberValue(r.sssLoan)+numberValue(r.pagibigLoan)+numberValue(r.companyLoan)+numberValue(r.cashAdvance));
  const deductions=round(absences+late+undertime+sss+phil+pagibig+tax+loans+numberValue(r.otherDeductions));
  const net=round(gross-deductions);

  return{basic,earnedBasic,absences,overtime,leavePay,allowances,earnings,gross,late,undertime,
    lateUt:round(late+undertime),sss,phil,pagibig,tax,loans,deductions,net,
    shortfall:net<0?round(-net):0};
}
