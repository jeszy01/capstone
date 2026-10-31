// Types for bonusTax.js, which the frontend imports.
export type BonusTaxTypeId='christmas'|'productivity'|'loyalty'|'gift'|'similar'|'commission'|'taxable';
export type BonusTaxType={id:BonusTaxTypeId;label:string;benefit:boolean};
export const BONUS_TAX_TYPES:BonusTaxType[];
export function bonusTaxType(id:unknown):BonusTaxType|undefined;
export function countsTowardBenefits(id:unknown):boolean;
