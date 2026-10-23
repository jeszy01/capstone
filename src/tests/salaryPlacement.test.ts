import {describe,expect,it} from 'vitest';
import {defaultGrades,gradeStructure,midpoint,spread,startingDailyRate,stepsFrom} from '../../backend-render/gradeStructure.js';
import {gradeHeadcount,placement,promotionTarget} from '../features/compensation/salaryPlacement';

const grades=defaultGrades();

describe('salary grades with steps',()=>{
 it('starts each grade at the position rate with steps 5% apart',()=>{
  expect(stepsFrom(755)).toEqual([755,793,832,874,918]);
  expect(grades.map(grade=>grade.code)).toEqual(['G1','G2','G3','G4','G5']);
  expect(grades[0]).toMatchObject({name:'Entry / Support',marketRate:837});
  expect(midpoint(grades[0])).toBe(836.5);
  expect(spread(grades[0])).toBe(22);
 });
 it('keeps saved edits, ignores invalid grades and always includes the catalog grades',()=>{
  const saved=[{code:'G1',name:'Entry',steps:[800,820,840,860,880],marketRate:850},{code:'G9',steps:[1,2]},{code:'G6',name:'Executive',steps:[2000,2100,2200,2300,2400]}];
  const structure=gradeStructure(saved);
  expect(structure.map(grade=>grade.code)).toEqual(['G1','G2','G3','G4','G5','G6']);
  expect(structure[0].steps[0]).toBe(800);
  expect(structure[5].marketRate).toBe(2200);
  expect(startingDailyRate('Rider',saved)).toBe(800);
  expect(startingDailyRate('Driver',null)).toBe(850);
  expect(startingDailyRate('Site Engineer',null)).toBeNull();
 });
});

describe('employee placement',()=>{
 it('finds the step, band, compa-ratio, market position and range position',()=>{
  const row=placement('Rider',832,grades,22);
  expect(row).toMatchObject({step:3,bandMin:16610,bandMax:20196,compaRatio:0.99,marketRate:18414,marketStatus:'At market',status:'Within band'});
  expect(row.rangePosition).toBeCloseTo(0.47,2);
  expect(placement('Rider',755,grades,22)).toMatchObject({step:1,rangePosition:0,marketStatus:'Below market',marketGap:-9.8});
  expect(placement('Rider',1000,grades,22)).toMatchObject({step:5,status:'Above band',marketStatus:'Above market',rangePosition:1});
  expect(placement('Rider',700,grades,22)).toMatchObject({step:0,status:'Below band'});
 });
 it('flags positions outside the catalog and employees without a salary',()=>{
  expect(placement('Site Engineer',900,grades,22).status).toBe('No grade');
  expect(placement('Rider',0,grades,22).status).toBe('No salary');
 });
 it('promotes to the next step, then to step 1 of the next grade',()=>{
  expect(promotionTarget(placement('Rider',793,grades,22),grades)).toMatchObject({step:3,dailyRate:832});
  expect(promotionTarget(placement('Rider',918,grades,22),grades)).toMatchObject({grade:{code:'G2'},step:3,dailyRate:937});
  expect(promotionTarget(placement('HR Manager',1945,grades,22),grades)).toBeNull();
 });
 it('counts employees per grade',()=>{
  expect(gradeHeadcount(['Rider','Driver','Dispatcher','Unknown',undefined])).toEqual({G1:1,G2:2});
 });
});
