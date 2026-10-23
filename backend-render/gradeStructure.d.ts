// Types for gradeStructure.js, which the frontend imports.
export type SalaryGradeBand={code:string;name:string;steps:number[];marketRate:number};
export const GRADE_STRUCTURE_KEY:string;
export const STEP_COUNT:number;
export function stepsFrom(start:number,increment?:number):number[];
export function defaultGrades():SalaryGradeBand[];
export function gradeStructure(saved:unknown):SalaryGradeBand[];
export function midpoint(grade:SalaryGradeBand):number;
export function spread(grade:SalaryGradeBand):number;
export function startingDailyRate(position:unknown,saved:unknown):number|null;
