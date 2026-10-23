import {describe,expect,it} from 'vitest';
import {DEPARTMENTS,PAY_GRADES,POSITIONS,positionGrade} from '../../backend-render/positionCatalog.js';

describe('position catalog',()=>{
 it('gives each position its department, grade and daily rate',()=>{
  expect(positionGrade('Rider')).toEqual({position:'Rider',department:'Fleet and Transportation',grade:'G1',marketRate:804,dailyRate:755});
  expect(positionGrade(' records clerk ')?.dailyRate).toBe(850);
  expect(positionGrade('Accounting Staff')?.dailyRate).toBe(1000);
  expect(positionGrade('Fleet Supervisor')?.dailyRate).toBe(1250);
  expect(positionGrade('Operations Manager')).toMatchObject({department:'E-Commerce Operations',grade:'G5',dailyRate:1600});
  expect(positionGrade('Site Engineer')).toBeNull();
  expect(positionGrade('Accountant')).toMatchObject({position:'Accounting Staff',grade:'G3',dailyRate:1000});
 });
 it('uses only defined grades and lists each department once',()=>{
  expect(POSITIONS).toHaveLength(18);
  expect(POSITIONS.every(item=>PAY_GRADES.some(grade=>grade.code===item.grade))).toBe(true);
  expect(new Set(DEPARTMENTS).size).toBe(DEPARTMENTS.length);
  expect(DEPARTMENTS).toContain('Facilities and Admin');
 });
});
