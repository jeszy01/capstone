# Withholding tax: items for accountant review

PBMS implements the rules below. Items marked **Confirm** rest on secondary sources or on an interpretation the
regulation text does not settle; please confirm or correct them before relying on PBMS for filing. Nothing here is a
claim of BIR compliance.

## Verified against regulation text

| Rule | Source checked | PBMS |
|---|---|---|
| Daily, weekly, semi-monthly, monthly tables from Jan 1, 2023; annual table | BIR table (RR 11-2018 Annex E, TRAIN) as reproduced by secondary sources; every bracket recomputed | All five tables match at every floor (the weekly table was wrong and is fixed). |
| Supplementary pay paid with regular pay | RR 2-98 Sec. 2.79(B), Step 5(ii): column from taxable regular compensation only; Step 6: excess of total regular + supplementary over the compensation level | Same method. |
| Cumulative average method | RR 2-98 Sec. 2.79(B): regular pay below the compensation level, supplementary ≥ regular, or newly hired with a previous employer | Same three conditions; once used, it continues for the year. |
| Year-end adjustment | RR 2-98 Sec. 2.79.6: before paying the last payroll period of the year | Last December payroll annualizes; it now includes every approved run of the year, including a 13th month run released inside the cutoff. |
| Separation before year end | RR 2-98 Sec. 2.79(B)(1)(b)(i); refund or deficiency with the last pay | A separated employee's last pay annualizes the year to date. |
| De minimis ceilings | RR 29-2025 (official BIR scan read page by page): leave 12 days, medical cash allowance to dependents ₱2,000/semester or ₱333/month, rice ₱2,500/month, uniform ₱8,000/year, actual medical assistance ₱12,000/year, laundry ₱400/month, achievement awards ₱12,000, gifts ₱6,000, OT/night meal 30% of regional minimum wage, CBA/productivity ₱12,000; effective 15 days after publication (published Dec 22, 2025 → Jan 6, 2026) | Rice, laundry, uniform/clothing, medical and monetized leave ceilings applied from Jan 6, 2026; RR 11-2018 ceilings before. |
| ₱90,000 13th month and other benefits | RA 10963 | Tracked across the year; excess is taxable. |
| Fixed allowances are compensation | RR 2-98 Sec. 2.78.1(A)(6): fixed or variable transportation, representation and other allowances are compensation subject to withholding; only advances/reimbursements for ordinary business expenses liquidated under NIRC Sec. 34 are not | An allowance type set as *taxable* is taxed as regular pay. Liquidated reimbursements belong in Claims & Reimbursement, not in allowances. |

## Confirm

1. **Excess de minimis counts toward the ₱90,000.** PBMS treats the part of a de minimis allowance above its ceiling as "other benefits" under the ₱90,000 exemption. Every source reviewed states this (it comes from RR 5-2011); the regulation text itself was not available to quote.
2. **Allowance types — now a setting.** Compensation Planning → Allowance Types has a *Tax treatment* for every type: taxable (fixed allowance) or one of the de minimis benefits with its ceiling. Until set, PBMS suggests one from the name ("Medical" → actual medical assistance, "Rice" → rice subsidy, and so on). **Please set each type.** Annual ceilings are spread evenly over the year's cutoffs, which fits recurring allowances.
3. **Allowances set as taxable** (by default Transportation, Meal, Communication, Housing) are taxed as regular compensation — confirmed by RR 2-98 Sec. 2.78.1(A)(6) above. Meal allowance for overtime/night shift (de minimis up to 30% of the regional minimum wage) is not modeled; pay it through Claims & Reimbursement or set the type as taxable.
4. **Paid leave — now a setting.** Payroll Settings → Withholding Tax → *Paid leave is taxed as*: Supplementary pay (default, unchanged behaviour) or Regular pay (with basic salary). RR 2-98 lists vacation and sick leave as compensation but does not say which class leave pay is. **Please choose.** Regular pay places leave with basic salary when the bracket is chosen and when the cumulative-average conditions are checked.
5. **Service incentive leave conversion** (the payslip's "Service Incentive Leave Conversion") is treated as monetized unused leave (de minimis up to 12 days a year at the daily rate). PBMS has no input for it yet, so it is always ₱0 today.
6. **Minimum wage earners.** An employee whose daily rate is at or below the *statutory minimum wage per day* set in Payroll Settings is an MWE. Exempt: basic pay (SMW), holiday pay, overtime, night differential, and paid leave (treated as part of the SMW, per secondary sources). Taxable: taxable allowances, taxable bonuses, benefits above ₱90,000. Mandatory contributions are still deducted from the MWE's taxable pay. Hazard pay is not modeled. Only one minimum wage can be set (one region); the rate in force must be entered by the Admin — sources disagree on whether NCR is ₱695 or ₱755 in October 2026. An MWE with taxable income from another employer is not detected.
7. **Contribution schedules** (defaults): SSS 15% (employee 5%, employer 10%), salary credit ₱5,000–₱35,000, EC ₱10/₱30 at ₱15,000; PhilHealth 5% split equally on ₱10,000–₱100,000; Pag-IBIG 2% each on up to ₱10,000 (employee 1% up to ₱1,500). These match 2026 secondary sources; please confirm against the SSS, PhilHealth and Pag-IBIG circulars.
8. **Pending runs** (changed October 25, 2026). Only approved runs (Approved, Funded, Exported, Paid, Closed) count toward the year to date. A payroll cannot be submitted while an earlier run of the same year is not yet approved or rejected, so a run Finance rejects never affects another run's tax. The year-end payroll and a separated employee's last pay still cannot be submitted while a relevant run is pending.
12. **13th month runs** (changed October 25, 2026). A 13th month run is a benefit payment, not a payroll period. Only the part above the remaining ₱90,000 is taxed: at the rate of the bracket of the employee's latest taxable regular compensation, or, for an employee on the cumulative-average method, as the increase in cumulative tax over the same number of periods. **Confirm** this treatment of supplementary compensation paid apart from regular pay; RR 11-2018 says supplementary compensation is paid "with or without regard to a payroll period" but gives no separate procedure. See `audit-2026-10-25.md`, questions Q1–Q12.
9. **13th month after the year-end payroll** is blocked; 13th month paid to an employee after their separation pay is not annualized again.
10. **BIR forms.** PBMS produces 1601-C, 2316 and alphalist *worksheets* from approved runs (Withholding Tax → BIR worksheets). They are not the eBIRForms or Alphalist Data Entry file formats. 1601-C uses the run's pay date month. The 2316 previous-employer figures are those entered in Review Payroll.
11. **BIR tax calculator.** The BIR online calculator could not be opened from the development environment, so results were not compared with it. Expected values were computed from the BIR tables and the RR 2-98 steps; the cases are in `src/tests/withholdingTaxCompliance.test.ts` and can be checked against the calculator.

## Not implemented

- RR 4-2025 (uniform ₱7,000) as a separate dated version — its effective date was not verified; for 2025 cutoffs PBMS uses the RR 11-2018 uniform ceiling (₱6,000).
- De minimis achievement awards, Christmas/anniversary gifts and CBA/productivity incentives: non-taxable bonuses count toward the ₱90,000, not against these separate ceilings.
- Official eBIRForms / alphalist DAT file output; BIR Form 2307/1604-C.
