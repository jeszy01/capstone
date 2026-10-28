// The tax type of a bonus or incentive. Christmas bonus, productivity incentives, loyalty awards, gifts and other benefits
// of a similar nature count toward the ₱90,000 13th month and other benefits exemption (RR 11-2018 Sec. 2.78.1(B)(11));
// commissions and other bonuses are taxable supplementary compensation (Sec. 2.79(B)(3), Step 1).
export const BONUS_TAX_TYPES = [
  { id: 'christmas', label: 'Christmas bonus', benefit: true },
  { id: 'productivity', label: 'Productivity incentive', benefit: true },
  { id: 'loyalty', label: 'Loyalty award', benefit: true },
  { id: 'gift', label: 'Gift', benefit: true },
  { id: 'similar', label: 'Other benefit of a similar nature', benefit: true },
  { id: 'commission', label: 'Commission', benefit: false },
  { id: 'taxable', label: 'Other taxable bonus', benefit: false },
];
export const bonusTaxType = id => BONUS_TAX_TYPES.find(type => type.id === id);
/** True when the tax type counts toward the ₱90,000 exemption; false when it is taxable or unknown. */
export const countsTowardBenefits = id => Boolean(bonusTaxType(id)?.benefit);
