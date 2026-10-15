import type {PayrollRates} from '../../types/domain';
import {loadRates} from '../settings/payrollSettings';

export type Agency='SSS'|'PhilHealth'|'Pag-IBIG';
export interface Contribution{agency:Agency;base:number;employee:number;employer:number;total:number;ec:number}

// All rates and limits come from PayrollRates (Payroll Settings). The SSS employer share includes the
// employer-only Employees' Compensation (EC) amount for the salary credit.

const round=(value:number)=>Math.round(value*100)/100;
const clamp=(value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));
export const pagibigEmployeeRate=(salary:number,rates:PayrollRates=loadRates())=>salary<=rates.pagibigLowerSalaryThreshold?rates.pagibigLowerEmployeeRate:rates.pagibigRate;
const make=(agency:Agency,base:number,employeeRate:number,employerRate:number,ec=0):Contribution=>{
 const employee=round(base*employeeRate/100),employer=round(base*employerRate/100+ec);
 return {agency,base,employee,employer,total:round(employee+employer),ec};
};

/** Monthly contributions for one employee, based on monthly salary. */
export function calculateContributions(monthlySalary:number,rates:PayrollRates=loadRates()):Record<Agency,Contribution>{
 const salary=Math.max(0,Number(monthlySalary)||0);
 if(salary===0)return {SSS:make('SSS',0,0,0),PhilHealth:make('PhilHealth',0,0,0),'Pag-IBIG':make('Pag-IBIG',0,0,0)};
 const sssBase=clamp(Math.round(salary/rates.sssStep)*rates.sssStep,rates.sssMin,rates.sssMax);
 const philBase=clamp(salary,rates.philMin,rates.philMax);
 const pagibigBase=Math.min(salary,rates.pagibigMax);
 return {
  SSS:make('SSS',sssBase,rates.sssRate,rates.sssEmployerRate,sssBase<rates.sssEcThreshold?rates.sssEcLow:rates.sssEcHigh),
  PhilHealth:make('PhilHealth',philBase,rates.philRate,rates.philEmployerRate),
  'Pag-IBIG':make('Pag-IBIG',pagibigBase,pagibigEmployeeRate(salary,rates),rates.pagibigEmployerRate),
 };
}
