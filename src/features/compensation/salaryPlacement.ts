import {PAY_GRADES,POSITIONS,positionGrade} from '../../../backend-render/positionCatalog.js';

export type PlacementStatus='On grade'|'Above grade'|'Below grade'|'No grade'|'No salary';
export type Placement={grade:string;gradeRate:number;dailyRate:number;variance:number;status:PlacementStatus};

/**
 * Where an employee's daily rate sits against their position's grade. "No grade": the position is not in the
 * position catalog. "No salary": the employee has no salary in effect.
 */
export function placement(position:string|undefined,dailyRate:number):Placement{
 const grade=positionGrade(position);
 const rate=Math.round(dailyRate*100)/100;
 if(!grade)return {grade:'',gradeRate:0,dailyRate:rate,variance:0,status:rate>0?'No grade':'No salary'};
 if(!(rate>0))return {grade:grade.grade,gradeRate:grade.dailyRate,dailyRate:0,variance:0,status:'No salary'};
 const variance=Math.round((rate-grade.dailyRate)*100)/100;
 return {grade:grade.grade,gradeRate:grade.dailyRate,dailyRate:rate,variance,status:Math.abs(variance)<0.01?'On grade':variance>0?'Above grade':'Below grade'};
}

/** Each grade with its daily rate, monthly equivalent and the positions in it. */
export const gradeFormat=(daysPerMonth:number)=>PAY_GRADES.map(grade=>({...grade,monthly:Math.round(grade.dailyRate*daysPerMonth*100)/100,positions:POSITIONS.filter(item=>item.grade===grade.code)}));
