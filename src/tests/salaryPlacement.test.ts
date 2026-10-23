import {describe,expect,it} from 'vitest';
import {defaultGrades,gradeStructure,midpoint,positionGradeCode,positionMarketRate,resolvePosition,spread,startingDailyRate,stepsBetween,stepsFrom} from '../../backend-render/gradeStructure.js';
import {allPositions,gradeHeadcount,placement,promotionTarget} from '../features/compensation/salaryPlacement';

const grades=defaultGrades();

describe('salary grades with steps',()=>{
 it('spans each grade over its positions market rates with steps evenly apart',()=>{
  expect(stepsFrom(755)).toEqual([755,793,832,874,918]);
  expect(stepsBetween(755,845)).toEqual([755,777,799,822,845]);
  expect(grades.map(grade=>grade.code)).toEqual(['G1','G2','G3','G4','G5']);
  expect(grades[0]).toMatchObject({name:'Entry / Support',marketRate:800});
  expect(midpoint(grades[0])).toBe(800);
  expect(spread(grades[0])).toBe(12);
 });
 it('keeps saved edits, ignores invalid grades and always includes the catalog grades',()=>{
  const saved=[{code:'G1',name:'Entry',steps:[800,820,840,860,880],marketRate:850},{code:'G9',steps:[1,2]},{code:'G6',name:'Executive',steps:[2000,2100,2200,2300,2400]}];
  const structure=gradeStructure(saved);
  expect(structure.map(grade=>grade.code)).toEqual(['G1','G2','G3','G4','G5','G6']);
  expect(structure[0].steps[0]).toBe(800);
  expect(structure[5].marketRate).toBe(2200);
 });
 it('starts a new hire at the position market rate, kept inside the grade',()=>{
  expect(startingDailyRate('Rider',null)).toBe(804);
  expect(startingDailyRate('Driver',null)).toBe(794);
  expect(startingDailyRate('HR Manager',null)).toBe(2062);
  expect(startingDailyRate('Rider',[{code:'G1',steps:[810,820,840,860,880]}])).toBe(810);
  expect(startingDailyRate('Site Engineer',null)).toBeNull();
  expect(positionMarketRate('Rider',{Rider:{marketRate:820}})).toBe(820);
 });
});

describe('employee placement',()=>{
 it('finds the step, band, compa-ratio, market position and range position',()=>{
  const row=placement('Rider',799,grades,22);
  expect(row).toMatchObject({step:3,bandMin:16610,bandMax:18590,compaRatio:1,marketRate:17688,marketStatus:'At market',marketGap:-0.6,status:'Within band'});
  expect(row.rangePosition).toBeCloseTo(0.49,2);
  expect(placement('Rider',755,grades,22)).toMatchObject({step:1,rangePosition:0,marketStatus:'Below market',marketGap:-6.1});
  expect(placement('Rider',900,grades,22)).toMatchObject({step:5,status:'Above band',marketStatus:'Above market',rangePosition:1});
  expect(placement('Rider',700,grades,22)).toMatchObject({step:0,status:'Below band'});
 });
 it('flags positions outside the catalog and employees without a salary',()=>{
  expect(placement('Site Engineer',900,grades,22).status).toBe('No grade');
  expect(placement('Rider',0,grades,22).status).toBe('No salary');
 });
 it('promotes to the next step, then to step 1 of the next grade',()=>{
  expect(promotionTarget(placement('Rider',777,grades,22),grades)).toMatchObject({step:3,dailyRate:799});
  expect(promotionTarget(placement('Rider',845,grades,22),grades)).toMatchObject({grade:{code:'G2'},step:3,dailyRate:875});
  expect(promotionTarget(placement('HR Manager',2365,grades,22),grades)).toBeNull();
 });
 it('counts employees per grade',()=>{
  expect(gradeHeadcount(['Rider','Driver','Dispatcher','Unknown',undefined])).toEqual({G1:1,G2:2});
 });
});

describe('position settings',()=>{
 it('uses HR\'s grade and market rate for a position',()=>{
  const settings={Rider:{grade:'G2',marketRate:900}};
  expect(positionGradeCode('rider',settings)).toBe('G2');
  expect(positionGradeCode('Driver',settings)).toBe('G2');
  expect(positionGradeCode('Site Engineer',settings)).toBeNull();
  expect(startingDailyRate('Rider',null,settings)).toBe(900);
  expect(placement('Rider',900,grades,22,settings)).toMatchObject({grade:{code:'G2'},marketStatus:'At market',marketGap:0});
  expect(gradeHeadcount(['Rider','Dispatcher'],settings)).toEqual({G2:2});
 });
});

describe('positions HR adds',()=>{
 it('resolves an added position by name with its department, grade and market rate',()=>{
  const settings={'Inventory Clerk':{department:'Supply Chain',grade:'G2',marketRate:800},Rider:{marketRate:820}};
  expect(resolvePosition(' inventory clerk ',settings)).toMatchObject({position:'Inventory Clerk',department:'Supply Chain',grade:'G2',marketRate:800,custom:true});
  expect(startingDailyRate('Inventory Clerk',null,settings)).toBe(800);
  expect(allPositions(settings).map(item=>item.position)).toContain('Inventory Clerk');
  expect(allPositions(settings).filter(item=>item.position==='Rider')).toHaveLength(1);
  expect(resolvePosition('Unknown',settings)).toBeNull();
 });
});
