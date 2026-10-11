import type {PayrollRates} from '../../types/domain';
import {DEFAULT_RATES} from '../payroll/payrollRules';

export type Agency='SSS'|'PhilHealth'|'Pag-IBIG';
export interface Contribution{agency:Agency;base:number;employee:number;employer:number;total:number}

// Employer rates, in percent of the same base. Employee rates come from PayrollRates.
// Not included: SSS Employees' Compensation (EC), which is an extra employer-only amount.
export const EMPLOYER_RATES={sss:10,phil:2.5,pagibig:2} as const;

const round=(value:number)=>Math.round(value*100)/100;
const clamp=(value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));
const make=(agency:Agency,base:number,employeeRate:number,employerRate:number):Contribution=>{
 const employee=round(base*employeeRate/100),employer=round(base*employerRate/100);
 return {agency,base,employee,employer,total:round(employee+employer)};
};

/** Monthly contributions for one employee, based on monthly salary. */
export function calculateContributions(monthlySalary:number,rates:PayrollRates=DEFAULT_RATES):Record<Agency,Contribution>{
 const salary=Math.max(0,Number(monthlySalary)||0);
 if(salary===0)return {SSS:make('SSS',0,0,0),PhilHealth:make('PhilHealth',0,0,0),'Pag-IBIG':make('Pag-IBIG',0,0,0)};
 const sssBase=clamp(Math.round(salary/500)*500,rates.sssMin,rates.sssMax);
 const philBase=clamp(salary,rates.philMin,rates.philMax);
 const pagibigBase=Math.min(salary,rates.pagibigMax);
 return {
  SSS:make('SSS',sssBase,rates.sssRate,EMPLOYER_RATES.sss),
  PhilHealth:make('PhilHealth',philBase,rates.philRate,EMPLOYER_RATES.phil),
  'Pag-IBIG':make('Pag-IBIG',pagibigBase,rates.pagibigRate,EMPLOYER_RATES.pagibig),
 };
}