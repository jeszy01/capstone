import type {AttendanceSchedule,OvertimeRounding,PayrollRates} from '../../types/domain';
import {DEFAULT_RATES} from '../payroll/payrollRules';
import {read,write} from '../../utils/storage';
import {DEFAULT_WITHHOLDING_RULES,loadWithholdingRules,ruleForDate} from '../payroll/withholdingTax';
import type {TaxBracket as EffectiveTaxBracket} from '../payroll/withholdingTax';

// Payroll Settings is the only home for payroll rates and rules. Every value is stored under a "payroll:" key so it
// synchronizes through app_data, and every module reads it through the loaders below.
export const RATES_KEY='payroll:rates';
export const TAX_KEY='payroll:tax-brackets';
export const TIME_SETTINGS_KEY='payroll:time-settings';
export const HOLIDAYS_KEY='payroll:holidays';

export interface TaxBracket{over:number;base:number;rate:number}
// BIR TRAIN monthly withholding table (in force from 2023). Tax = base + rate% x (income - over).
export const DEFAULT_TAX_BRACKETS:TaxBracket[]=DEFAULT_WITHHOLDING_RULES.tables.monthly;

export const loadRates=():PayrollRates=>{
 const saved=read<Partial<PayrollRates>>(RATES_KEY,{});
 const rates={...DEFAULT_RATES,...saved};
 // Settings saved before the PhilHealth total rate existed: the total is the sum of the saved shares.
 return saved.philTotalRate===undefined?{...rates,philTotalRate:rates.philRate+rates.philEmployerRate}:rates;
};
export const saveRates=(rates:PayrollRates)=>write(RATES_KEY,rates);
export const loadTaxBrackets=(date=new Date().toISOString().slice(0,10)):TaxBracket[]=>ruleForDate(date,loadWithholdingRules()).tables.monthly as EffectiveTaxBracket[];
export const saveTaxBrackets=(rows:TaxBracket[])=>write(TAX_KEY,rows);

export interface TimeSettings{shiftStart:string;shiftEnd:string;ndStart:string;ndEnd:string;otRounding:OvertimeRounding}
export const DEFAULT_TIME_SETTINGS:TimeSettings={shiftStart:'08:00',shiftEnd:'17:00',ndStart:'22:00',ndEnd:'06:00',otRounding:'none'};
export const loadTimeSettings=():TimeSettings=>({...DEFAULT_TIME_SETTINGS,...read<Partial<TimeSettings>>(TIME_SETTINGS_KEY,{})});
export const saveTimeSettings=(settings:TimeSettings)=>write(TIME_SETTINGS_KEY,settings);
export const OVERTIME_ROUNDING:Array<[OvertimeRounding,string]>=[['none','No rounding'],['15','Round down to 15 minutes'],['30','Round down to 30 minutes'],['60','Round down to 1 hour']];
export const loadAttendanceSchedule=():AttendanceSchedule=>{const time=loadTimeSettings();return {start:time.shiftStart,end:time.shiftEnd,otMin:loadRates().otMinMinutes,otRounding:time.otRounding}};

export type HolidayType='Regular Holiday'|'Special Non-Working Day'|'Special Working Day';
export const HOLIDAY_TYPES:HolidayType[]=['Regular Holiday','Special Non-Working Day','Special Working Day'];
export interface Holiday{id:string;date:string;name:string;type:HolidayType}
export const loadHolidays=():Holiday[]=>read<Holiday[]>(HOLIDAYS_KEY,[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
export const saveHolidays=(holidays:Holiday[])=>write(HOLIDAYS_KEY,[...holidays].sort((a,b)=>a.date.localeCompare(b.date)));

export interface RateField{key:keyof PayrollRates;label:string;unit:string;percent?:boolean;integer?:boolean}
export const RATE_FIELDS:Record<'time'|'schedule'|'holiday'|'sss'|'philhealth'|'pagibig',RateField[]>={
 time:[
  {key:'hoursPerDay',label:'Paid hours per day',unit:'hrs'},
  {key:'daysPerMonth',label:'Working days per month',unit:'days'},
  {key:'otMultiplier',label:'Overtime multiplier',unit:'x'},
  {key:'otRestMultiplier',label:'Rest day overtime multiplier',unit:'x'},
  {key:'ndRate',label:'Night differential',unit:'%',percent:true},
  {key:'otMinMinutes',label:'Overtime minimum threshold',unit:'min',integer:true},
 ],
 schedule:[
  {key:'payPeriodsPerMonth',label:'Pay periods per month',unit:'periods',integer:true},
  {key:'firstCutoffEndDay',label:'1st cutoff end day',unit:'day',integer:true},
  {key:'firstPayDay',label:'1st cutoff pay day',unit:'day',integer:true},
  {key:'secondPayDay',label:'2nd cutoff pay day',unit:'day',integer:true},
 ],
 holiday:[
  {key:'holidayRegularUnworked',label:'Regular holiday, unworked',unit:'x'},
  {key:'holidayRegularWorked',label:'Regular holiday, worked',unit:'x'},
  {key:'holidayRegularRestDay',label:'Regular holiday on rest day, worked',unit:'x'},
  {key:'holidaySpecialWorked',label:'Special non-working day, worked',unit:'x'},
  {key:'holidaySpecialRestDay',label:'Special non-working day on rest day, worked',unit:'x'},
  {key:'holidayDouble',label:'Two holidays on the same day, worked',unit:'x'},
  {key:'holidaySpecialWorking',label:'Special working day, worked',unit:'x'},
 ],
 sss:[
  {key:'sssRate',label:'Employee rate',unit:'%',percent:true},
  {key:'sssEmployerRate',label:'Employer rate',unit:'%',percent:true},
  {key:'sssMin',label:'Minimum salary credit',unit:'₱'},
  {key:'sssMax',label:'Maximum salary credit',unit:'₱'},
  {key:'sssStep',label:'Salary credit step',unit:'₱'},
  {key:'sssEcLow',label:'EC amount below threshold',unit:'₱'},
  {key:'sssEcHigh',label:'EC amount at or above threshold',unit:'₱'},
  {key:'sssEcThreshold',label:'EC salary credit threshold',unit:'₱'},
 ],
 philhealth:[
  {key:'philTotalRate',label:'Total rate',unit:'%',percent:true},
  {key:'philRate',label:'Employee share',unit:'%',percent:true},
  {key:'philEmployerRate',label:'Employer share',unit:'%',percent:true},
  {key:'philMin',label:'Salary floor',unit:'₱'},
  {key:'philMax',label:'Salary ceiling',unit:'₱'},
 ],
 pagibig:[
  {key:'pagibigRate',label:'Employee rate',unit:'%',percent:true},
  {key:'pagibigEmployerRate',label:'Employer rate',unit:'%',percent:true},
  {key:'pagibigLowerEmployeeRate',label:'Lower-income employee rate',unit:'%',percent:true},
  {key:'pagibigLowerSalaryThreshold',label:'Lower-income threshold',unit:'₱'},
  {key:'pagibigMax',label:'Maximum fund salary',unit:'₱'},
 ],
};
const ALL_FIELDS=Object.values(RATE_FIELDS).flat();
export const FIELD_LABELS=Object.fromEntries(ALL_FIELDS.map(field=>[field.key,field.label])) as Record<keyof PayrollRates,string>;

export function validateRates(v:PayrollRates):string[]{
 const errors:string[]=[];
 for(const key of Object.keys(DEFAULT_RATES) as Array<keyof PayrollRates>){
  if(!Number.isFinite(v[key])||v[key]<0)errors.push(`${FIELD_LABELS[key]??key} must be a number, 0 or more.`);
 }
 if(errors.length)return errors;
 for(const field of ALL_FIELDS){
  if(field.percent&&v[field.key]>100)errors.push(`${field.label} cannot be more than 100%.`);
  if(field.integer&&!Number.isInteger(v[field.key]))errors.push(`${field.label} must be a whole number.`);
 }
 if(v.hoursPerDay<1||v.hoursPerDay>24)errors.push('Paid hours per day must be between 1 and 24.');
 if(v.daysPerMonth<1||v.daysPerMonth>31)errors.push('Working days per month must be between 1 and 31.');
 if(v.payPeriodsPerMonth!==1&&v.payPeriodsPerMonth!==2)errors.push('Pay periods per month must be 1 or 2.');
 if(v.firstCutoffEndDay<1||v.firstCutoffEndDay>27)errors.push('1st cutoff end day must be from 1 to 27.');
 if(v.firstPayDay<1||v.firstPayDay>31||v.secondPayDay<1||v.secondPayDay>31)errors.push('Pay days must be from 1 to 31.');
 if(v.otMultiplier<1||v.otRestMultiplier<1)errors.push('Overtime multipliers must be at least 1.');
 if(v.sssStep<=0)errors.push('SSS salary credit step must be more than 0.');
 if(v.pagibigMax<=0)errors.push('Pag-IBIG maximum fund salary must be more than 0.');
 if(v.pagibigLowerSalaryThreshold<=0)errors.push('Pag-IBIG lower-income threshold must be more than 0.');
 if(v.sssMin>v.sssMax)errors.push('SSS minimum salary credit cannot be higher than the maximum.');
 if(v.philMin>v.philMax)errors.push('PhilHealth salary floor cannot be higher than the ceiling.');
 if(Math.abs(v.philRate+v.philEmployerRate-v.philTotalRate)>0.0001)errors.push('PhilHealth employee and employer shares must add up to the total rate.');
 return [...new Set(errors)];
}

const validTime=(value:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validateTimeSettings(settings:TimeSettings):string[]{
 const errors:string[]=[];
 if(!validTime(settings.shiftStart)||!validTime(settings.shiftEnd))errors.push('Enter a valid shift start and end.');
 else if(settings.shiftStart===settings.shiftEnd)errors.push('Shift start and end cannot be the same.');
 if(!validTime(settings.ndStart)||!validTime(settings.ndEnd))errors.push('Enter a valid night differential window.');
 else if(settings.ndStart===settings.ndEnd)errors.push('Night differential start and end cannot be the same.');
 if(!OVERTIME_ROUNDING.some(([value])=>value===settings.otRounding))errors.push('Select a rounding rule.');
 return errors;
}

export function validateTaxBrackets(rows:TaxBracket[]):string[]{
 const errors:string[]=[];
 if(!rows.length)return ['The tax table needs at least one bracket.'];
 rows.forEach((row,i)=>{
  if(![row.over,row.base,row.rate].every(Number.isFinite)||row.over<0||row.base<0)errors.push(`Tax bracket ${i+1}: enter numbers that are 0 or more.`);
  else if(row.rate<0||row.rate>100)errors.push(`Tax bracket ${i+1}: rate must be from 0 to 100%.`);
 });
 if(errors.length)return errors;
 if(rows[0].over!==0)errors.push('The first tax bracket must start at 0.');
 for(let i=1;i<rows.length;i++)if(rows[i].over<=rows[i-1].over)errors.push(`Tax bracket ${i+1} must start higher than bracket ${i}.`);
 return errors;
}

const pad=(value:number)=>String(value).padStart(2,'0');
const lastDay=(year:number,month:number)=>new Date(Date.UTC(year,month,0)).getUTCDate();
/** Cutoff number (1 or 2) of a month, using the Pay Schedule settings. */
export function cutoffFor(month:string,cutoff:1|2,rates=loadRates()){
 const [y,m]=month.split('-').map(Number);
 if(rates.payPeriodsPerMonth===1)return {from:`${month}-01`,to:`${month}-${pad(lastDay(y,m))}`};
 return cutoff===1?{from:`${month}-01`,to:`${month}-${pad(rates.firstCutoffEndDay)}`}:{from:`${month}-${pad(rates.firstCutoffEndDay+1)}`,to:`${month}-${pad(lastDay(y,m))}`};
}
export const cutoffNumberFor=(date:string,rates=loadRates()):1|2=>rates.payPeriodsPerMonth===1||Number(date.slice(8,10))<=rates.firstCutoffEndDay?1:2;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** Compact range label: "Oct 1 - 15, 2026", "Oct 26 - Nov 10, 2026" or "Dec 16, 2026 - Jan 15, 2027". */
export function shortRange(from:string,to:string){
 const [fy,fm,fd]=from.split('-').map(Number),[ty,tm,td]=to.split('-').map(Number);
 if(fy!==ty)return `${MONTHS[fm-1]} ${fd}, ${fy} - ${MONTHS[tm-1]} ${td}, ${ty}`;
 return fm===tm?`${MONTHS[fm-1]} ${fd} - ${td}, ${fy}`:`${MONTHS[fm-1]} ${fd} - ${MONTHS[tm-1]} ${td}, ${fy}`;
}
/** Short date label, e.g. "Oct 7". */
export const shortDate=(date:string)=>`${MONTHS[Number(date.slice(5,7))-1]} ${Number(date.slice(8,10))}`;
/** The cutoff containing the given date and the ones before it, newest first, from the Pay Schedule settings. */
export function recentCutoffs(count=6,date=new Date().toLocaleDateString('en-CA'),rates=loadRates()){
 const list:Array<{from:string;to:string}>=[];
 let [year,month]=date.split('-').map(Number),half=cutoffNumberFor(date,rates);
 while(list.length<count){
  list.push(cutoffFor(`${year}-${pad(month)}`,half,rates));
  if(rates.payPeriodsPerMonth===2&&half===2)half=1;
  else{month-=1;if(month===0){month=12;year-=1}half=rates.payPeriodsPerMonth===2?2:1}
 }
 return list;
}
/** Pay date for a cutoff: a pay day before the cutoff ends falls in the following month; days past month end are clamped. */
export function payDateFor(from:string,to:string,rates=loadRates()){
 const day=rates.payPeriodsPerMonth===1||cutoffNumberFor(from,rates)===2?rates.secondPayDay:rates.firstPayDay;
 let [y,m]=to.split('-').map(Number);
 if(day<Number(to.slice(8,10))){m+=1;if(m>12){m=1;y+=1}}
 return `${y}-${pad(m)}-${pad(Math.min(day,lastDay(y,m)))}`;
}

/** The settings used to generate a payroll run, stored on the run so later edits do not change it. */
export function payrollSettingsSnapshot(date:string){
 return {rates:loadRates(),time:loadTimeSettings(),holidays:loadHolidays(),withholdingRuleId:ruleForDate(date,loadWithholdingRules()).id,capturedAt:new Date().toISOString()};
}
export type PayrollSettingsSnapshot=ReturnType<typeof payrollSettingsSnapshot>;
