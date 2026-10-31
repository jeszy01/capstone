import type {Employee} from '../../types/domain';
import {numberValue,read,write} from '../../utils/storage';
import {isApprovedRun,isThirteenthMonthRun,taxYearOf} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';

// 13th month pay = basic salary earned in the calendar year ÷ 12, less amounts already released that year.
export interface ThirteenthMonthRules{excludeAllowances:boolean;excludeOvertime:boolean;excludeHolidayPay:boolean;excludeNightDifferential:boolean;minimumServiceMonths:number;managerialPositions:string[];releaseDeadline:string;allowInstallments:boolean;installments:number}
export const THIRTEENTH_MONTH_RULES_KEY='payroll:thirteenth-month-rules';
const LEGACY_THIRTEENTH_MONTH_RULES_KEY='compensation:thirteenth-month-rules';
export const DEFAULT_THIRTEENTH_MONTH_RULES:ThirteenthMonthRules={excludeAllowances:true,excludeOvertime:true,excludeHolidayPay:true,excludeNightDifferential:true,minimumServiceMonths:1,managerialPositions:[],releaseDeadline:'12-24',allowInstallments:false,installments:2};
export const loadThirteenthMonthRules=():ThirteenthMonthRules=>({...DEFAULT_THIRTEENTH_MONTH_RULES,...read<Partial<ThirteenthMonthRules>>(LEGACY_THIRTEENTH_MONTH_RULES_KEY,{}),...read<Partial<ThirteenthMonthRules>>(THIRTEENTH_MONTH_RULES_KEY,{})});
export const saveThirteenthMonthRules=(rules:ThirteenthMonthRules)=>write(THIRTEENTH_MONTH_RULES_KEY,rules);

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function validateThirteenthMonthRules(rules:ThirteenthMonthRules):string[]{
 const errors:string[]=[];
 if(!Number.isInteger(rules.minimumServiceMonths)||rules.minimumServiceMonths<0)errors.push('Minimum service must be a whole number of months, 0 or more.');
 const [month,day]=rules.releaseDeadline.split('-').map(Number);
 if(!/^\d{2}-\d{2}$/.test(rules.releaseDeadline)||month<1||month>12||day<1||day>new Date(Date.UTC(2024,month,0)).getUTCDate())errors.push('Enter a valid release deadline.');
 if(rules.allowInstallments&&(!Number.isInteger(rules.installments)||rules.installments<2||rules.installments>4))errors.push('Installments must be a whole number from 2 to 4.');
 return errors;
}

export function monthsOfService(hired:string,date:string){
 if(!hired)return Number.POSITIVE_INFINITY;
 const [y1,m1,d1]=hired.slice(0,10).split('-').map(Number),[y2,m2,d2]=date.split('-').map(Number);
 return (y2-y1)*12+(m2-m1)-(d2<d1?1:0);
}
export const releaseDeadlineFor=(year:string,rules:ThirteenthMonthRules)=>`${year}-${rules.releaseDeadline}`;

export interface ThirteenthMonthLine{empId:string;name:string;position:string;basicEarned:number;accrued:number;released:number;amount:number}

/**
 * Basic salary earned comes from approved regular payroll runs of the year up to the release date, so unpaid
 * days are already excluded and partial-year or separated employees are pro-rated by what they earned. A run counts in
 * the year it is paid (taxYearOf), so a cutoff spanning the new year (Dec 26 - Jan 9, paid Jan 15) counts once, in
 * the new year; counting it by its start date left its pay out of every year's 13th month.
 */
export function computeThirteenthMonth({runs,employees,rules,releaseDate}:{runs:PayrollRun[];employees:Employee[];rules:ThirteenthMonthRules;releaseDate:string}):ThirteenthMonthLine[]{
 const year=releaseDate.slice(0,4);
 const counted=runs.filter(run=>isApprovedRun(run)&&taxYearOf(run)===year&&run.to<=releaseDate);
 const managerial=new Set(rules.managerialPositions.map(item=>item.trim().toLowerCase()));
 const lines=new Map<string,ThirteenthMonthLine>();
 for(const run of counted)for(const row of run.rows){
  const empId=row.input.empId;
  const line=lines.get(empId)??{empId,name:row.input.name,position:row.position,basicEarned:0,accrued:0,released:0,amount:0};
  if(isThirteenthMonthRun(run))line.released+=numberValue(row.input.thirteenthMonthAndOtherBenefits);
  else{
   const result=row.result;
   // Basic pay actually earned: after absences, late and undertime.
   line.basicEarned+=Math.max(0,(result.earnedBasic??result.basic-(result.absences??0))-(result.late??0)-(result.undertime??0))+result.leavePay
    +(rules.excludeAllowances?0:result.allowances??0)
    +(rules.excludeOvertime?0:result.overtime)
    +(rules.excludeHolidayPay?0:numberValue(row.input.holidayPay))
    +(rules.excludeNightDifferential?0:numberValue(row.input.nightDifferential));
  }
  lines.set(empId,line);
 }
 return [...lines.values()].flatMap(line=>{
  const employee=employees.find(item=>item.employeeNo===line.empId||item.id===line.empId);
  const position=employee?.position||line.position;
  if(managerial.has(position.trim().toLowerCase()))return [];
  if(monthsOfService(employee?.dateHired??'',releaseDate)<rules.minimumServiceMonths)return [];
  const accrued=round(line.basicEarned/12),amount=round(Math.max(0,accrued-line.released));
  return amount>0?[{...line,name:employee?.name||line.name,position,basicEarned:round(line.basicEarned),accrued,released:round(line.released),amount}]:[];
 });
}
