import {positionGrade} from '../../../backend-render/positionCatalog.js';
import {GRADE_STRUCTURE_KEY,POSITION_GRADES_KEY,STEP_COUNT,gradeStructure,midpoint,positionGradeCode} from '../../../backend-render/gradeStructure.js';
import type {SalaryGradeBand} from '../../../backend-render/gradeStructure.js';
import {read,write} from '../../utils/storage';

export type RangeStatus='Below band'|'Within band'|'Above band'|'No grade'|'No salary';
export type MarketStatus='Below market'|'At market'|'Above market';
export type Placement={grade:SalaryGradeBand|null;step:number;dailyRate:number;bandMin:number;bandMax:number;compaRatio:number;
 marketRate:number;marketGap:number;marketStatus:MarketStatus|null;rangePosition:number;status:RangeStatus};

export const loadGrades=():SalaryGradeBand[]=>gradeStructure(read<unknown>(GRADE_STRUCTURE_KEY,null));
export const saveGrades=(grades:SalaryGradeBand[])=>write(GRADE_STRUCTURE_KEY,grades);
/** HR's per-position grade and market rate (daily), keyed by catalog position. */
export type PositionSettings=Record<string,{grade?:string;marketRate?:number}>;
export const loadPositionSettings=()=>read<PositionSettings>(POSITION_GRADES_KEY,{});
export const savePositionSettings=(settings:PositionSettings)=>write(POSITION_GRADES_KEY,settings);
const round=(value:number,places=2)=>Math.round(value*10**places)/10**places;
// Within 2% of the market rate counts as at market.
export const MARKET_TOLERANCE=0.02;

/**
 * Where an employee's daily rate sits in their position's grade. Band, market rate and rates are monthly
 * (daily x working days). step: the highest step the rate reaches (0 below step 1). compaRatio: rate / grade midpoint.
 * rangePosition: 0 at step 1 to 1 at the top step.
 */
export function placement(position:string|undefined,dailyRate:number,grades:SalaryGradeBand[],daysPerMonth:number,settings:PositionSettings=loadPositionSettings()):Placement{
 const code=positionGradeCode(position,settings),grade=code?grades.find(item=>item.code===code)??null:null;
 const ownMarket=settings[positionGrade(position)?.position??'']?.marketRate;
 const market=grade?(ownMarket&&ownMarket>0?ownMarket:grade.marketRate):0;
 const rate=round(dailyRate);
 const empty={grade,step:0,dailyRate:rate,bandMin:0,bandMax:0,compaRatio:0,marketRate:0,marketGap:0,marketStatus:null,rangePosition:0};
 if(!grade)return {...empty,status:rate>0?'No grade':'No salary'};
 const bandMin=round(grade.steps[0]*daysPerMonth),bandMax=round(grade.steps[STEP_COUNT-1]*daysPerMonth),marketRate=round(market*daysPerMonth);
 if(!(rate>0))return {...empty,bandMin,bandMax,marketRate,status:'No salary'};
 const step=grade.steps.filter(value=>rate+0.005>=value).length;
 const marketGap=round((rate-market)/market*100,1);
 const span=grade.steps[STEP_COUNT-1]-grade.steps[0];
 return {grade,step,dailyRate:rate,bandMin,bandMax,marketRate,marketGap,
  compaRatio:round(rate/midpoint(grade)),
  marketStatus:Math.abs(marketGap)<=MARKET_TOLERANCE*100?'At market':marketGap>0?'Above market':'Below market',
  rangePosition:span>0?Math.min(1,Math.max(0,(rate-grade.steps[0])/span)):1,
  status:rate<grade.steps[0]-0.005?'Below band':rate>grade.steps[STEP_COUNT-1]+0.005?'Above band':'Within band'};
}

/**
 * The next step up: the following step in the grade; from the top step, the first step of a higher grade above the
 * current rate (grades overlap, so that may be past step 1). Null when no higher step exists.
 */
export function promotionTarget(current:Placement,grades:SalaryGradeBand[]){
 if(!current.grade||current.status==='No salary')return null;
 const grade=current.grade,above=(value:number)=>value>current.dailyRate+0.005;
 const nextStep=grade.steps.findIndex(above);
 if(nextStep>=0)return {grade,step:nextStep+1,dailyRate:grade.steps[nextStep]};
 for(const higher of grades.filter(item=>item.code.localeCompare(grade.code,undefined,{numeric:true})>0)){
  const step=higher.steps.findIndex(above);
  if(step>=0)return {grade:higher,step:step+1,dailyRate:higher.steps[step]};
 }
 return null;
}

/** Headcount per grade code, from employees' positions. */
export const gradeHeadcount=(positions:Array<string|undefined>,settings:PositionSettings=loadPositionSettings())=>positions.reduce<Record<string,number>>((counts,position)=>{
 const code=positionGradeCode(position,settings);
 if(code)counts[code]=(counts[code]??0)+1;
 return counts;
},{});

// ---- Performance ratings, kept per employee in app data; HR sets them in Employee Placement ----
export const RATINGS_KEY='compensation:ratings';
export type EmployeeRating={rating:number;ratedAt:string;ratedBy?:string};
export const loadRatings=()=>read<Record<string,EmployeeRating>>(RATINGS_KEY,{});
export const saveRatings=(ratings:Record<string,EmployeeRating>)=>write(RATINGS_KEY,ratings);
