import {describe,expect,it} from 'vitest';
import {DEFAULT_BANDS,bandForRate,compaRatio,rangePosition} from '../features/compensation/salaryBands';

const band=(code:string)=>DEFAULT_BANDS.find(item=>item.code===code)!;

describe('salary structure bands',()=>{
 it('computes the compa-ratio against the band midpoint',()=>{
  expect(compaRatio(625,band('G2'))).toBe(1.04);
  expect(compaRatio(500,band('G1'))).toBe(1);
  expect(compaRatio(550,band('G1'))).toBe(1.1);
  expect(compaRatio(600,band('G2'))).toBe(1);
 });
 it('places a rate below, within or above its band',()=>{
  expect(rangePosition(500,band('G1'))).toBe('Within range');
  expect(rangePosition(400,band('G1'))).toBe('Below range');
  expect(rangePosition(700,band('G2'))).toBe('Above range');
 });
 it('defaults a position to the band containing its rate, else the nearest band',()=>{
  expect(bandForRate(500,DEFAULT_BANDS)).toBe('G1');
  expect(bandForRate(700,DEFAULT_BANDS)).toBe('G3');
  expect(bandForRate(300,DEFAULT_BANDS)).toBe('G1');
  expect(bandForRate(900,DEFAULT_BANDS)).toBe('G3');
 });
});
