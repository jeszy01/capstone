// Types for gradeStructure.js, which the frontend imports.
export type SalaryGradeBand={code:string;name:string;steps:number[];marketRate:number};
export const GRADE_STRUCTURE_KEY:string;
export const POSITION_GRADES_KEY:string;
export const STEP_COUNT:number;
export function stepsFrom(start:number,increment?:number):number[];
export function stepsBetween(min:number,max:number):number[];
export function defaultGrades():SalaryGradeBand[];
export function gradeStructure(saved:unknown):SalaryGradeBand[];
export function midpoint(grade:SalaryGradeBand):number;
export function spread(grade:SalaryGradeBand):number;
export type ResolvedPosition={position:string;department:string;grade:string;marketRate:number;catalogGrade:string;custom:boolean};
export function resolvePosition(position:unknown,overrides?:unknown):ResolvedPosition|null;
export function positionGradeCode(position:unknown,overrides?:unknown):string|null;
export function positionMarketRate(position:unknown,overrides?:unknown):number|null;
export function startingDailyRate(position:unknown,saved:unknown,overrides?:unknown):number|null;
