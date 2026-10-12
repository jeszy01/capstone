import type {PayrollRates} from '../../types/domain';
import {DEFAULT_RATES} from '../payroll/payrollRules';
import {read,write} from '../../utils/storage';
import {DEFAULT_WITHHOLDING_RULES,loadWithholdingRules,ruleForDate} from '../payroll/withholdingTax';
import type {TaxBracket as EffectiveTaxBracket} from '../payroll/withholdingTax';

// Stored under "payroll:" keys so they sync like other payroll data (admin-only writes).
export const RATES_KEY='payroll:rates';
export const TAX_KEY='payroll:tax-brackets';

export interface TaxBracket{over:number;base:number;rate:number}
// BIR TRAIN monthly withholding table (in force from 2023). Tax = base + rate% x (income - over).
export const DEFAULT_TAX_BRACKETS:TaxBracket[]=DEFAULT_WITHHOLDING_RULES.tables.monthly;

export const loadRates=():PayrollRates=>({...DEFAULT_RATES,...read<Partial<PayrollRates>>(RATES_KEY,{})});
export const saveRates=(rates:PayrollRates)=>write(RATES_KEY,rates);
export const loadTaxBrackets=(date=new Date().toISOString().slice(0,10)):TaxBracket[]=>ruleForDate(date,loadWithholdingRules()).tables.monthly as EffectiveTaxBracket[];
export const saveTaxBrackets=(rows:TaxBracket[])=>write(TAX_KEY,rows);

export interface SettingField{key:keyof PayrollRates;label:string;unit:string}
export interface SettingGroup{id:string;title:string;description:string;fields:SettingField[]}
export const SETTING_GROUPS:SettingGroup[]=[
 {id:'time',title:'Working time & overtime',description:'Used to turn salary into daily and hourly rates, and to split monthly contributions per pay period.',fields:[
  {key:'hoursPerDay',label:'Paid hours per day',unit:'hrs'},
  {key:'daysPerMonth',label:'Working days per month',unit:'days'},
  {key:'payPeriodsPerMonth',label:'Pay periods per month (2 = semi-monthly)',unit:'periods'},
  {key:'otMultiplier',label:'Overtime multiplier',unit:'x'},
  {key:'otRestMultiplier',label:'Rest day / holiday overtime multiplier',unit:'x'},
 ]},
 {id:'sss',title:'SSS',description:'Contribution is a percentage of the salary credit, which is the salary rounded to the step and kept between the minimum and maximum.',fields:[
  {key:'sssRate',label:'Employee rate',unit:'%'},
  {key:'sssEmployerRate',label:'Employer rate',unit:'%'},
  {key:'sssMin',label:'Minimum salary credit',unit:'₱'},
  {key:'sssMax',label:'Maximum salary credit',unit:'₱'},
  {key:'sssStep',label:'Salary credit step',unit:'₱'},
 ]},
 {id:'philhealth',title:'PhilHealth',description:'Contribution is a percentage of monthly salary, kept between the floor and the ceiling.',fields:[
  {key:'philRate',label:'Employee rate',unit:'%'},
  {key:'philEmployerRate',label:'Employer rate',unit:'%'},
  {key:'philMin',label:'Salary floor',unit:'₱'},
  {key:'philMax',label:'Salary ceiling',unit:'₱'},
 ]},
 {id:'pagibig',title:'Pag-IBIG',description:'Contribution is a percentage of monthly salary, capped at the maximum fund salary.',fields:[
  {key:'pagibigRate',label:'Employee rate',unit:'%'},
  {key:'pagibigEmployerRate',label:'Employer rate',unit:'%'},
  {key:'pagibigMax',label:'Maximum fund salary',unit:'₱'},
 ]},
];
export const FIELD_LABELS=Object.fromEntries(SETTING_GROUPS.flatMap(g=>g.fields.map(f=>[f.key,`${g.title}: ${f.label}`]))) as Record<keyof PayrollRates,string>;

export function validateRates(v:PayrollRates):string[]{
 const errors:string[]=[];
 for(const key of Object.keys(DEFAULT_RATES) as Array<keyof PayrollRates>){
  if(!Number.isFinite(v[key])||v[key]<0)errors.push(`${FIELD_LABELS[key]} must be a number, 0 or more.`);
 }
 if(errors.length)return errors;
 if(v.hoursPerDay<1||v.hoursPerDay>24)errors.push('Paid hours per day must be between 1 and 24.');
 if(v.daysPerMonth<1||v.daysPerMonth>31)errors.push('Working days per month must be between 1 and 31.');
 if(!Number.isInteger(v.payPeriodsPerMonth)||v.payPeriodsPerMonth<1||v.payPeriodsPerMonth>4)errors.push('Pay periods per month must be a whole number from 1 to 4.');
 if(v.otMultiplier<1||v.otRestMultiplier<1)errors.push('Overtime multipliers must be at least 1.');
 if(v.sssStep<=0)errors.push('SSS salary credit step must be more than 0.');
 if(v.pagibigMax<=0)errors.push('Pag-IBIG maximum fund salary must be more than 0.');
 if(v.sssMin>v.sssMax)errors.push('SSS minimum salary credit cannot be higher than the maximum.');
 if(v.philMin>v.philMax)errors.push('PhilHealth salary floor cannot be higher than the ceiling.');
 for(const key of ['sssRate','sssEmployerRate','philRate','philEmployerRate','pagibigRate','pagibigEmployerRate'] as const){
  if(v[key]>100)errors.push(`${FIELD_LABELS[key]} cannot be more than 100%.`);
 }
 return errors;
}

export function validateTaxBrackets(rows:TaxBracket[]):string[]{
 const errors:string[]=[];
 if(!rows.length)return ['The tax table needs at least one bracket.'];
 rows.forEach((row,i)=>{
  if(![row.over,row.base,row.rate].every(Number.isFinite)||row.over<0||row.base<0)errors.push(`Tax bracket ${i+1}: enter numbers that are 0 or more.`);
  else if(row.rate>100)errors.push(`Tax bracket ${i+1}: rate cannot be more than 100%.`);
 });
 if(errors.length)return errors;
 if(rows[0].over!==0)errors.push('The first tax bracket must start at 0.');
 for(let i=1;i<rows.length;i++)if(rows[i].over<=rows[i-1].over)errors.push(`Tax bracket ${i+1} must start higher than bracket ${i}.`);
 return errors;
}
