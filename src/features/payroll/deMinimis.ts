// De minimis benefits (RR 2-98 Sec. 2.78.1(A)(3)): exempt up to the ceilings below. An amount above a ceiling is
// "other benefits" and counts toward the ₱90,000 13th month and other benefits exemption.

export type DeMinimisCategory='rice'|'laundry'|'medicalDependents'|'uniform'|'medicalAssistance';
export interface DeMinimisRule{
 effectiveFrom:string;source:string;
 /** Monetized unused vacation leave of private employees: days per year. */
 monetizedLeaveDays:number;
 monthly:Record<'rice'|'laundry'|'medicalDependents',number>;
 annual:Record<'uniform'|'medicalAssistance',number>;
}
/**
 * RR 11-2018 ceilings, then RR 29-2025 (published Dec 22, 2025; effective 15 days later, January 6, 2026).
 * RR 4-2025 (uniform ₱7,000) is not a separate version: its effective date was not verified.
 */
export const DE_MINIMIS_RULES:DeMinimisRule[]=[
 {effectiveFrom:'2018-01-01',source:'RR 11-2018',monetizedLeaveDays:10,monthly:{rice:2000,laundry:300,medicalDependents:250},annual:{uniform:6000,medicalAssistance:10000}},
 {effectiveFrom:'2026-01-06',source:'RR 29-2025',monetizedLeaveDays:12,monthly:{rice:2500,laundry:400,medicalDependents:333},annual:{uniform:8000,medicalAssistance:12000}},
];
export const deMinimisRuleFor=(date:string)=>[...DE_MINIMIS_RULES].reverse().find(rule=>rule.effectiveFrom<=date)??DE_MINIMIS_RULES[0];

/** Labels for the tax treatment choices in Allowance Types. */
export const DE_MINIMIS_LABELS:Record<DeMinimisCategory,string>={rice:'Rice subsidy',laundry:'Laundry allowance',uniform:'Uniform and clothing allowance',medicalAssistance:'Actual medical assistance',medicalDependents:'Medical cash allowance to dependents'};
export const deMinimisCeilingLabel=(category:DeMinimisCategory,date:string)=>{const rule=deMinimisRuleFor(date);return category==='uniform'||category==='medicalAssistance'?`₱${rule.annual[category].toLocaleString()} a year`:`₱${rule.monthly[category].toLocaleString()} a month`};
/** The suggested de minimis category of an allowance type from its name, until one is chosen in Allowance Types. */
export function deMinimisCategory(allowanceType:string):DeMinimisCategory|null{
 const name=allowanceType.trim().toLowerCase();
 if(name.includes('rice'))return 'rice';
 if(name.includes('laundry'))return 'laundry';
 if(name.includes('clothing')||name.includes('uniform'))return 'uniform';
 if(name.includes('medical')&&name.includes('dependent'))return 'medicalDependents';
 if(name.includes('medical'))return 'medicalAssistance';
 return null;
}

/** The exempt amount of one category for one cutoff: a monthly ceiling ÷ pay periods per month, an annual ceiling ÷ pay periods per year. */
export function deMinimisCutoffCeiling(category:DeMinimisCategory,date:string,payPeriodsPerMonth:number){
 const rule=deMinimisRuleFor(date),periods=Math.max(1,payPeriodsPerMonth);
 return category==='uniform'||category==='medicalAssistance'?rule.annual[category]/(12*periods):rule.monthly[category]/periods;
}
