import {describe,expect,it} from 'vitest';
import {gradeFormat,placement} from '../features/compensation/salaryPlacement';

describe('salary structure placement',()=>{
 it('compares the daily rate with the position grade',()=>{
  expect(placement('Rider',755)).toEqual({grade:'G1',gradeRate:755,dailyRate:755,variance:0,status:'On grade'});
  expect(placement('driver',900)).toMatchObject({grade:'G2',variance:50,status:'Above grade'});
  expect(placement('HR Manager',1500)).toMatchObject({grade:'G5',variance:-100,status:'Below grade'});
 });
 it('flags positions outside the catalog and employees without a salary',()=>{
  expect(placement('Site Engineer',900)).toMatchObject({grade:'',status:'No grade'});
  expect(placement('Rider',0)).toMatchObject({grade:'G1',status:'No salary'});
  expect(placement('',0).status).toBe('No salary');
 });
 it('lists each grade with its monthly rate and positions',()=>{
  const grades=gradeFormat(22);
  expect(grades.map(grade=>grade.code)).toEqual(['G1','G2','G3','G4','G5']);
  expect(grades[0]).toMatchObject({dailyRate:755,monthly:16610});
  expect(grades[0].positions.map(item=>item.position)).toEqual(['Rider','Warehouse Helper','Utility Staff']);
 });
});
