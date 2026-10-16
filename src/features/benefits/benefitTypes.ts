import type {Employee,EmploymentStatus} from '../../types/domain';
import {read,write} from '../../utils/storage';

// Company benefit programs and enrollments. Stored under "benefits:" keys, which the app-data sync shares across
// devices. The fields mirror the benefit_plans and benefit_enrollments tables for a later move to the database.
export type BenefitCategory='Mandatory'|'De Minimis'|'Allowance in Kind'|'Leave'|'Insurance';
export const benefitCategories:BenefitCategory[]=['Mandatory','De Minimis','Allowance in Kind','Leave','Insurance'];
// "computed" marks a benefit whose amount payroll works out itself, such as 13th month pay.
export type BenefitValueType='monthly'|'yearly'|'coverage'|'days'|'computed';
export const valueTypeLabels:Record<BenefitValueType,string>={monthly:'Amount per month (₱)',yearly:'Amount per year (₱)',coverage:'Coverage amount (₱)',days:'Days per year',computed:'Computed by payroll'};
export const defaultValueType:Record<BenefitCategory,BenefitValueType>={Mandatory:'computed','De Minimis':'monthly','Allowance in Kind':'monthly',Leave:'days',Insurance:'coverage'};
export const hasAmount=(valueType:BenefitValueType)=>valueType!=='computed';
// Resigned employees are never eligible, so they are not offered as an eligibility choice.
export const eligibleStatusOptions:EmploymentStatus[]=['Regular','Probationary','Part-Time','Contractual','Project-Based','Temporary'];

export type ProgramStatus='Active'|'Inactive';
export interface BenefitProgram{id:string;name:string;category:BenefitCategory;provider:string;coverage:string;valueType:BenefitValueType;value:number;
 /** Employment statuses that qualify; empty means every active, non-resigned employee. */
 eligibleStatuses:EmploymentStatus[];minServiceMonths:number;status:ProgramStatus;createdAt:string;updatedAt:string}
export interface BenefitEnrollment{id:string;programId:string;employeeId:string;effectiveDate:string;endDate:string;status:'Active'|'Ended';notes:string;createdAt:string;updatedAt:string}

const PROGRAMS_KEY='benefits:programs',ENROLLMENTS_KEY='benefits:enrollments';
export const loadPrograms=()=>read<BenefitProgram[]>(PROGRAMS_KEY,[]);
export const savePrograms=(programs:BenefitProgram[])=>write(PROGRAMS_KEY,programs);
export const loadEnrollments=()=>read<BenefitEnrollment[]>(ENROLLMENTS_KEY,[]);
export const saveEnrollments=(enrollments:BenefitEnrollment[])=>write(ENROLLMENTS_KEY,enrollments);

/** Whole months between the hire date and the as-of date (YYYY-MM-DD). */
export function monthsOfService(dateHired:string,asOf:string){
 if(!/^\d{4}-\d{2}-\d{2}/.test(dateHired))return 0;
 const [hy,hm,hd]=dateHired.slice(0,10).split('-').map(Number),[ay,am,ad]=asOf.split('-').map(Number);
 return Math.max(0,(ay-hy)*12+(am-hm)-(ad<hd?1:0));
}

/** Reasons the employee cannot be enrolled in the program on the given date; empty when eligible. */
export function eligibilityProblems(employee:Employee,program:BenefitProgram,asOf:string):string[]{
 const problems:string[]=[];
 if(program.status!=='Active')problems.push('This benefit program is inactive.');
 if(employee.status!=='Active'||employee.employmentStatus==='Resigned')problems.push('Only active employees can be enrolled.');
 else if(program.eligibleStatuses.length&&!(employee.employmentStatus&&program.eligibleStatuses.includes(employee.employmentStatus)))problems.push(`Open to ${program.eligibleStatuses.join(', ')} employees only${employee.employmentStatus?` (this employee is ${employee.employmentStatus})`:''}.`);
 const months=monthsOfService(employee.dateHired,asOf);
 if(months<program.minServiceMonths)problems.push(`Requires ${program.minServiceMonths} month${program.minServiceMonths===1?'':'s'} of service (has ${months}).`);
 return problems;
}

export const enrollmentOpen=(enrollment:BenefitEnrollment)=>enrollment.status==='Active';
/** Scheduled enrollments start in the future; ended ones have been closed. */
export function enrollmentState(enrollment:BenefitEnrollment,today:string):'Active'|'Scheduled'|'Ended'{
 if(enrollment.status==='Ended')return 'Ended';
 return enrollment.effectiveDate>today?'Scheduled':'Active';
}
/** An employee may hold one open enrollment per program. */
export const hasOpenEnrollment=(enrollments:BenefitEnrollment[],programId:string,employeeId:string)=>enrollments.some(item=>enrollmentOpen(item)&&item.programId===programId&&item.employeeId===employeeId);

export function programValue(program:BenefitProgram){
 if(program.valueType==='computed')return 'Computed by payroll';
 if(program.valueType==='days')return `${program.value} day${program.value===1?'':'s'} / year`;
 const amount='₱'+program.value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 return program.valueType==='monthly'?`${amount} / month`:program.valueType==='yearly'?`${amount} / year`:program.valueType==='coverage'?`${amount} coverage`:'—';
}
export function programEligibility(program:BenefitProgram){
 const who=program.eligibleStatuses.length?program.eligibleStatuses.join(', '):'All employees';
 return program.minServiceMonths>0?`${who} · ${program.minServiceMonths}+ months`:who;
}

/** Monthly peso cost of enrollments in effect today: monthly amounts, plus yearly amounts spread over 12 months. */
export function monthlyCost(programs:BenefitProgram[],enrollments:BenefitEnrollment[],today:string){
 const byId=new Map(programs.map(program=>[program.id,program]));
 const cost=enrollments.filter(item=>enrollmentState(item,today)==='Active').reduce((sum,item)=>{const program=byId.get(item.programId);return program?.valueType==='monthly'?sum+program.value:program?.valueType==='yearly'?sum+program.value/12:sum},0);
 return Math.round(cost*100)/100;
}

export type BenefitTemplate=Pick<BenefitProgram,'name'|'category'|'coverage'|'valueType'|'value'|'eligibleStatuses'|'minServiceMonths'>;
// Payroll-related benefits HR can start from. Amounts left at 0 are entered by HR. The leave and service rules follow
// the general Philippine rules and should be confirmed against company policy before use.
export const benefitTemplates:BenefitTemplate[]=[
 {name:'13th Month Pay',category:'Mandatory',valueType:'computed',value:0,eligibleStatuses:[],minServiceMonths:1,coverage:'1/12 of basic salary earned in the calendar year (PD 851). Computed and paid through a 13th Month Pay payroll run.'},
 {name:'Service Incentive Leave',category:'Mandatory',valueType:'days',value:5,eligibleStatuses:[],minServiceMonths:12,coverage:'5 paid leave days a year after one year of service. Unused days can be converted to cash.'},
 {name:'Maternity Leave',category:'Mandatory',valueType:'days',value:105,eligibleStatuses:[],minServiceMonths:0,coverage:'105 days paid leave (RA 11210): SSS maternity benefit plus the employer salary differential.'},
 {name:'Paternity Leave',category:'Mandatory',valueType:'days',value:7,eligibleStatuses:[],minServiceMonths:0,coverage:'7 days paid leave for married male employees (RA 8187).'},
 {name:'Solo Parent Leave',category:'Mandatory',valueType:'days',value:7,eligibleStatuses:[],minServiceMonths:6,coverage:'7 days paid leave a year for solo parents with a Solo Parent ID.'},
 {name:'Rice Subsidy',category:'De Minimis',valueType:'monthly',value:0,eligibleStatuses:['Regular'],minServiceMonths:0,coverage:'Tax-exempt up to the BIR de minimis limit. Paid in payroll through Compensation Planning → Allowances.'},
 {name:'Uniform / Clothing Allowance',category:'De Minimis',valueType:'yearly',value:0,eligibleStatuses:[],minServiceMonths:0,coverage:'Tax-exempt up to the BIR de minimis limit. Paid in payroll through Compensation Planning → Allowances.'},
 {name:'Medical Cash Allowance for Dependents',category:'De Minimis',valueType:'yearly',value:0,eligibleStatuses:['Regular'],minServiceMonths:0,coverage:'Tax-exempt up to the BIR de minimis limit. Paid in payroll through Compensation Planning → Allowances.'},
];
