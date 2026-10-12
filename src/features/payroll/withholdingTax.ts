import {read,write} from '../../utils/storage';

export type PayrollPeriod='daily'|'weekly'|'semi-monthly'|'monthly';
export interface TaxBracket{over:number;base:number;rate:number}
export interface DeMinimisCap{id:string;label:string;amount:number;unit:'annual'|'monthly'|'semi-annual'|'per day as % of regional minimum wage'|'days per year';}
export interface WithholdingTaxRuleSet{
 id:string; effectiveFrom:string; effectiveTo?:string; source:string;
 tables:Record<PayrollPeriod,TaxBracket[]>; annualTable:TaxBracket[];
 annualBenefitsExemption:number;
 deMinimisEffectiveFrom:string;deMinimisSource:string;deMinimisCaps:DeMinimisCap[];
}
export const WITHHOLDING_RULES_KEY='payroll:withholding-tax-rules';
const rrTable=(rows:Array<[number,number,number]>):TaxBracket[]=>rows.map(([over,base,rate])=>({over,base,rate}));
/** RR 11-2018 Annex E (compensation paid from 2023 onward) and RA 10963 annual rates. */
export const DEFAULT_WITHHOLDING_RULES:WithholdingTaxRuleSet={
 id:'bir-train-rr29-2025',effectiveFrom:'2023-01-01',source:'RA 10963; RR 11-2018 Annex E (effective 2023 onward); RR 2-98, as amended',annualBenefitsExemption:90000,
 deMinimisEffectiveFrom:'2026-01-06',deMinimisSource:'RR 29-2025 (effective 2026-01-06)',deMinimisCaps:[
  {id:'unused-vacation-leave',label:'Monetized unused vacation leave (private employees)',amount:12,unit:'days per year'},
  {id:'medical-cash-dependents',label:'Medical cash allowance for dependents',amount:2000,unit:'semi-annual'},
  {id:'rice-subsidy',label:'Rice subsidy',amount:2500,unit:'monthly'},
  {id:'uniform-clothing',label:'Uniform and clothing allowance',amount:8000,unit:'annual'},
  {id:'actual-medical-assistance',label:'Actual medical assistance',amount:12000,unit:'annual'},
  {id:'laundry',label:'Laundry allowance',amount:400,unit:'monthly'},
  {id:'achievement-awards',label:'Achievement awards (established non-discriminatory plan)',amount:12000,unit:'annual'},
  {id:'gifts',label:'Christmas and major-anniversary gifts',amount:6000,unit:'annual'},
  {id:'overtime-meal',label:'Daily meal allowance for overtime/night shift',amount:30,unit:'per day as % of regional minimum wage'},
  {id:'cba-productivity',label:'CBA benefits and productivity incentives (combined)',amount:12000,unit:'annual'},
 ],
 tables:{
  daily:rrTable([[0,0,0],[685,0,15],[1096,61.65,20],[2192,280.85,25],[5479,1102.6,30],[21918,6034.3,35]]),
  weekly:rrTable([[0,0,0],[4808,0,15],[7692,0,20],[15385,432.6,25],[38462,1971.2,30],[153846,7740.45,35]]),
  'semi-monthly':rrTable([[0,0,0],[10417,0,15],[16667,937.5,20],[33333,4270.7,25],[83333,16770.7,30],[333333,91770.7,35]]),
  monthly:rrTable([[0,0,0],[20833,0,15],[33333,1875,20],[66667,8541.8,25],[166667,33541.8,30],[666667,183541.8,35]]),
 },
 annualTable:rrTable([[0,0,0],[250000,0,15],[400000,22500,20],[800000,102500,25],[2000000,402500,30],[8000000,2202500,35]]),
};
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(`${s}T00:00:00Z`))&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
export function validateRuleSet(rule:WithholdingTaxRuleSet):string[]{
 const errors:string[]=[]; if(!validDate(rule.effectiveFrom))errors.push('Effective-from date must be a valid ISO date.');if(!rule.source.trim())errors.push('A source citation is required for the withholding schedule.');
 if(rule.effectiveTo&&(!validDate(rule.effectiveTo)||rule.effectiveTo<rule.effectiveFrom))errors.push('Effective-to date must be on or after effective-from date.');
 if(!Number.isFinite(rule.annualBenefitsExemption)||rule.annualBenefitsExemption<0)errors.push('Annual 13th-month and other-benefits exemption must be 0 or more.');
 if(!validDate(rule.deMinimisEffectiveFrom))errors.push('De minimis effective-from date must be a valid ISO date.');
 if(!rule.deMinimisSource.trim())errors.push('A source citation is required for de minimis ceilings.');
 const ids=new Set<string>();for(const cap of rule.deMinimisCaps??[]){if(!cap.id||ids.has(cap.id))errors.push('Each de minimis ceiling needs a unique identifier.');ids.add(cap.id);if(!cap.label.trim()||!Number.isFinite(cap.amount)||cap.amount<0)errors.push(`Invalid de minimis ceiling: ${cap.label||cap.id}.`)}
 for(const key of ['daily','weekly','semi-monthly','monthly'] as PayrollPeriod[])errors.push(...validateTable(rule.tables[key],`${key} table`));
 errors.push(...validateTable(rule.annualTable,'annual table')); return errors;
}
function validateTable(table:TaxBracket[],name:string){const e:string[]=[];if(!Array.isArray(table)||!table.length)return [`${name} needs at least one bracket.`];for(let i=0;i<table.length;i++){const b=table[i];if(![b.over,b.base,b.rate].every(Number.isFinite)||b.over<0||b.base<0||b.rate<0||b.rate>100)e.push(`${name}: bracket ${i+1} has an invalid amount or rate.`);if(i===0&&b.over!==0)e.push(`${name}: first bracket must start at 0.`);if(i>0&&b.over<=table[i-1].over)e.push(`${name}: bracket thresholds must increase.`)}return e;}
export function loadWithholdingRules():WithholdingTaxRuleSet[]{
 const saved=read<WithholdingTaxRuleSet[]>(WITHHOLDING_RULES_KEY,[]);
 if(saved.length)return saved.map(rule=>({...DEFAULT_WITHHOLDING_RULES,...rule,tables:{...DEFAULT_WITHHOLDING_RULES.tables,...rule.tables},deMinimisEffectiveFrom:rule.deMinimisEffectiveFrom??DEFAULT_WITHHOLDING_RULES.deMinimisEffectiveFrom,deMinimisSource:rule.deMinimisSource??DEFAULT_WITHHOLDING_RULES.deMinimisSource,deMinimisCaps:rule.deMinimisCaps??structuredClone(DEFAULT_WITHHOLDING_RULES.deMinimisCaps)})).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
 const legacy=read<TaxBracket[]>('payroll:tax-brackets',[]);
 const initial=structuredClone(DEFAULT_WITHHOLDING_RULES);
 if(legacy.length)initial.tables.monthly=legacy;
 return [initial];
}
export function saveWithholdingRules(rules:WithholdingTaxRuleSet[]){write(WITHHOLDING_RULES_KEY,[...rules].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)));}
export function ruleForDate(date:string,rules=loadWithholdingRules()):WithholdingTaxRuleSet{
 const eligible=rules.filter(rule=>rule.effectiveFrom<=date&&(!rule.effectiveTo||date<=rule.effectiveTo)).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
 const prior=rules.filter(rule=>rule.effectiveFrom<=date).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
 return eligible[0]??prior[0]??DEFAULT_WITHHOLDING_RULES;
}
export function taxFromTable(income:number,table:TaxBracket[]):number{
 const amount=Math.max(0,income);const bracket=[...table].sort((a,b)=>b.over-a.over).find(row=>amount>=row.over);
 return bracket?round(bracket.base+(bracket.rate/100)*(amount-bracket.over)):0;
}
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function detectPayrollPeriod(from:string,to:string,configuredPayPeriods=2):PayrollPeriod{
 if(!from||!to)return configuredPayPeriods===1?'monthly':'semi-monthly';
 const days=Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
 if(days<=2)return 'daily'; if(days<=8)return 'weekly'; if(days<=17)return 'semi-monthly'; return 'monthly';
}
export interface AnnualTaxHistory{regular:number;supplementary:number;benefitPayments:number;taxExemptBenefits:number;mandatoryContributions:number;withheld:number;payrollPeriods:number;cumulativeAverage?:boolean}
export interface WithholdingTaxInput{
 regularCompensation:number;supplementaryCompensation:number;thirteenthMonthAndOtherBenefits?:number;taxExemptBenefits?:number;mandatoryContributions?:number;
 period:PayrollPeriod;periodStart:string;periodEnd:string;priorYear?:AnnualTaxHistory;finalPeriod?:boolean;rules?:WithholdingTaxRuleSet[];
}
export interface WithholdingTaxBreakdown{
 status:'Calculated'|'Cumulative average'|'Year-end adjusted';ruleId:string;ruleSource:string;period:PayrollPeriod;
 grossCompensation:number;regularCompensation:number;supplementaryCompensation:number;benefitPayments:number;benefitExemptionApplied:number;taxExemptBenefits:number;mandatoryContributions:number;taxableRegular:number;taxableSupplementary:number;taxableCompensation:number;taxBeforeAdjustment:number;yearToDateTaxableCompensation?:number;annualTaxLiability?:number;priorTaxWithheld?:number;withholdingTax:number;explanation:string;
}
export function calculateWithholdingTax(input:WithholdingTaxInput):WithholdingTaxBreakdown{
 const rules=input.rules??loadWithholdingRules();const rule=ruleForDate(input.periodEnd||input.periodStart,rules);
 const prior=input.priorYear??{regular:0,supplementary:0,benefitPayments:0,taxExemptBenefits:0,mandatoryContributions:0,withheld:0,payrollPeriods:0};
 const regular=Math.max(0,input.regularCompensation||0),supp=Math.max(0,input.supplementaryCompensation||0),benefits=Math.max(0,input.thirteenthMonthAndOtherBenefits||0),exempt=Math.max(0,input.taxExemptBenefits||0),contrib=Math.max(0,input.mandatoryContributions||0);
 const priorBenefits=Math.max(0,prior.benefitPayments||0),benefitExemption=Math.min(benefits,Math.max(0,rule.annualBenefitsExemption-priorBenefits));
 const taxablePeriod=Math.max(0,regular+supp+benefits-benefitExemption-exempt-contrib);
 const periodTable=rule.tables[input.period];
 const taxableRegular=Math.max(0,regular-contrib);
 const bracket=[...periodTable].sort((a,b)=>b.over-a.over).find(row=>taxableRegular>=row.over);
 const taxBefore=bracket?round(Math.max(0,bracket.base+(bracket.rate/100)*(taxablePeriod-bracket.over))):0;
 const priorRegular=Math.max(0,prior.regular||0),priorSupp=Math.max(0,prior.supplementary||0),priorExempt=Math.max(0,prior.taxExemptBenefits||0),priorContrib=Math.max(0,prior.mandatoryContributions||0);
 const ytdTaxable=Math.max(0,priorRegular+priorSupp+priorBenefits-Math.min(priorBenefits,rule.annualBenefitsExemption)+regular+supp+benefits-benefitExemption-priorExempt-exempt-priorContrib-contrib);
 const gross=regular+supp+benefits+exempt;
 const payrollPeriods=Math.max(1,(prior.payrollPeriods||0)+1);
 const cumulativeRequired=Boolean(prior.cumulativeAverage)||taxableRegular<(periodTable[1]?.over??0)||(supp+Math.max(0,benefits-benefitExemption-exempt))>=taxableRegular;
 const cumulativeTax=taxFromTable(ytdTaxable/payrollPeriods,periodTable)*payrollPeriods;
 const periodTax=cumulativeRequired?round(Math.max(0,cumulativeTax-Math.max(0,prior.withheld||0))):taxBefore;
 if(input.finalPeriod){
  const annualLiability=taxFromTable(ytdTaxable,rule.annualTable);const priorWithheld=Math.max(0,prior.withheld||0);
  return{status:'Year-end adjusted',ruleId:rule.id,ruleSource:rule.source,period:input.period,grossCompensation:gross,regularCompensation:regular,supplementaryCompensation:supp,benefitPayments:benefits,benefitExemptionApplied:benefitExemption,taxExemptBenefits:exempt,mandatoryContributions:contrib,taxableRegular:Math.max(0,regular-contrib),taxableSupplementary:Math.max(0,supp+benefits-benefitExemption-exempt),taxableCompensation:taxablePeriod,taxBeforeAdjustment:taxBefore,yearToDateTaxableCompensation:ytdTaxable,annualTaxLiability:annualLiability,priorTaxWithheld:priorWithheld,withholdingTax:round(annualLiability-priorWithheld),explanation:'Annualized liability on year-to-date taxable compensation less withholding already recorded for the year; a negative adjustment is a refund/credit.'};
 }
 return{status:cumulativeRequired?'Cumulative average':'Calculated',ruleId:rule.id,ruleSource:rule.source,period:input.period,grossCompensation:gross,regularCompensation:regular,supplementaryCompensation:supp,benefitPayments:benefits,benefitExemptionApplied:benefitExemption,taxExemptBenefits:exempt,mandatoryContributions:contrib,taxableRegular,taxableSupplementary:Math.max(0,supp+benefits-benefitExemption-exempt),taxableCompensation:taxablePeriod,taxBeforeAdjustment:taxBefore,withholdingTax:periodTax,explanation:cumulativeRequired?'Cumulative-average method: annual-to-date taxable compensation is averaged over the payroll periods, taxed using the applicable period table, then prior withholding is credited. The cumulative method continues for the remainder of the calendar year.':'RR 11-2018 method: select the bracket using taxable regular compensation, then apply its base amount and marginal rate to total taxable regular and supplementary compensation.'};
}
