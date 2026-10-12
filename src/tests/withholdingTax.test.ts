import {describe,expect,it} from 'vitest';
import {calculateWithholdingTax,DEFAULT_WITHHOLDING_RULES,detectPayrollPeriod,taxFromTable,validateRuleSet} from '../features/payroll/withholdingTax';

describe('effective-dated Philippine withholding rules',()=>{
 it('validates the shipped BIR TRAIN baseline and resolves a rule by effective date',()=>{
  expect(validateRuleSet(DEFAULT_WITHHOLDING_RULES)).toEqual([]);
  expect(DEFAULT_WITHHOLDING_RULES.effectiveFrom).toBe('2023-01-01');
  expect(DEFAULT_WITHHOLDING_RULES.deMinimisEffectiveFrom).toBe('2026-01-06');
  expect(DEFAULT_WITHHOLDING_RULES.deMinimisCaps.find(cap=>cap.id==='rice-subsidy')?.amount).toBe(2500);
 });
 it('uses period-specific Annex E tables',()=>{
  expect(detectPayrollPeriod('2026-03-01','2026-03-01')).toBe('daily');
  expect(detectPayrollPeriod('2026-03-01','2026-03-07')).toBe('weekly');
  expect(detectPayrollPeriod('2026-03-01','2026-03-15')).toBe('semi-monthly');
  expect(detectPayrollPeriod('2026-03-01','2026-03-31')).toBe('monthly');
  expect(taxFromTable(25000,DEFAULT_WITHHOLDING_RULES.tables.monthly)).toBeCloseTo(625.05,2);
  expect(taxFromTable(25000,DEFAULT_WITHHOLDING_RULES.tables['semi-monthly'])).toBeCloseTo(2604.1,2);
 });
 it('selects the ordinary payroll bracket from regular compensation, then applies the marginal rate to total compensation',()=>{
  const result=calculateWithholdingTax({regularCompensation:30000,supplementaryCompensation:5000,period:'monthly',periodStart:'2026-03-01',periodEnd:'2026-03-31'});
  expect(result.status).toBe('Calculated');
  expect(result.taxBeforeAdjustment).toBeCloseTo(2125.05,2);
  expect(result.withholdingTax).toBeCloseTo(2125.05,2);
 });
 it('uses cumulative average when supplementary compensation equals or exceeds regular compensation',()=>{
  const result=calculateWithholdingTax({regularCompensation:30000,supplementaryCompensation:30000,period:'monthly',periodStart:'2026-03-01',periodEnd:'2026-03-31'});
  expect(result.status).toBe('Cumulative average');
  expect(result.taxBeforeAdjustment).toBeCloseTo(5875.05,2);
  expect(result.withholdingTax).toBeCloseTo(7208.4,2);
 });
 it('subtracts mandatory employee contributions and applies only the remaining 13th-month exemption',()=>{
  const result=calculateWithholdingTax({regularCompensation:30000,supplementaryCompensation:0,thirteenthMonthAndOtherBenefits:100000,mandatoryContributions:1000,period:'monthly',periodStart:'2026-12-01',periodEnd:'2026-12-31'});
  expect(result.benefitExemptionApplied).toBe(90000);
  expect(result.taxableCompensation).toBe(39000);
  expect(result.grossCompensation).toBe(130000);
 });
 it('annualizes final December liability and offsets prior tax withheld',()=>{
  const result=calculateWithholdingTax({regularCompensation:120000,supplementaryCompensation:0,thirteenthMonthAndOtherBenefits:20000,mandatoryContributions:1000,period:'monthly',periodStart:'2026-12-01',periodEnd:'2026-12-31',finalPeriod:true,priorYear:{regular:200000,supplementary:0,benefitPayments:80000,taxExemptBenefits:0,mandatoryContributions:10000,withheld:3500,payrollPeriods:11}});
  expect(result.status).toBe('Year-end adjusted');
  expect(result.yearToDateTaxableCompensation).toBe(319000);
  expect(result.annualTaxLiability).toBe(10350);
  expect(result.withholdingTax).toBe(6850);
 });
});
