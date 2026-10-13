import {describe,expect,it} from 'vitest';
import {calculateContributions} from '../features/contributions/contributionCalculator';

describe('government contributions',()=>{
 it('computes employee and employer shares for a 18,000 salary',()=>{
  const c=calculateContributions(18000);
  expect(c.SSS).toMatchObject({base:18000,employee:900,employer:1800,total:2700});
  expect(c.PhilHealth).toMatchObject({base:18000,employee:450,employer:450,total:900});
  expect(c['Pag-IBIG']).toMatchObject({base:10000,employee:200,employer:200,total:400});
 });
 it('applies the SSS and PhilHealth ceilings for a 50,000 salary',()=>{
  const c=calculateContributions(50000);
  expect(c.SSS).toMatchObject({base:35000,employee:1750,employer:3500});
  expect(c.PhilHealth).toMatchObject({base:50000,employee:1250,employer:1250});
 });
 it('applies the SSS floor and returns zero for no salary',()=>{
  expect(calculateContributions(4000).SSS.base).toBe(5000);
  expect(calculateContributions(0).SSS.total).toBe(0);
 });
 it('uses the Pag-IBIG 1% employee tier at ₱1,500 and 2% above it',()=>{
  expect(calculateContributions(1500)['Pag-IBIG'].employee).toBe(15);
  expect(calculateContributions(1501)['Pag-IBIG'].employee).toBeCloseTo(30.02,2);
  expect(calculateContributions(1500)['Pag-IBIG'].employer).toBe(30);
 });
});
