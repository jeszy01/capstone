import {read,write} from '../../utils/storage';

/** A pay grade's daily-rate range (Salary Structure). */
export type GradeBand={code:string;min:number;max:number};
// positions: salary grade (position) id -> its pay grade code; a position not set here falls in the band containing its rate.
export type SalaryStructure={bands:GradeBand[];positions:Record<string,string>};
export type RangePosition='Below range'|'Within range'|'Above range';

export const SALARY_STRUCTURE_KEY='compensation:salary-structure';
export const DEFAULT_BANDS:GradeBand[]=[{code:'G1',min:450,max:550},{code:'G2',min:550,max:650},{code:'G3',min:650,max:800}];

export function loadSalaryStructure():SalaryStructure{
 const saved=read<Partial<SalaryStructure>>(SALARY_STRUCTURE_KEY,{});
 return {bands:Array.isArray(saved.bands)&&saved.bands.length?saved.bands:DEFAULT_BANDS,positions:saved.positions&&typeof saved.positions==='object'?saved.positions:{}};
}
export const saveSalaryStructure=(structure:SalaryStructure)=>write(SALARY_STRUCTURE_KEY,structure);

/** The first band whose range contains the daily rate, or the nearest band below or above it. */
export function bandForRate(rate:number,bands:GradeBand[]){
 return bands.find(band=>rate>=band.min&&rate<=band.max)?.code??(rate<(bands[0]?.min??0)?bands[0]?.code:bands[bands.length-1]?.code)??'';
}
export const midpoint=(band:GradeBand)=>(band.min+band.max)/2;
/** Compa-ratio: the daily rate divided by the band's midpoint, to 2 decimals. */
export const compaRatio=(rate:number,band:GradeBand)=>midpoint(band)>0?Math.round(rate/midpoint(band)*100)/100:0;
export const rangePosition=(rate:number,band:GradeBand):RangePosition=>rate<band.min?'Below range':rate>band.max?'Above range':'Within range';
