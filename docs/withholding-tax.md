# Philippine withholding tax on compensation

## What this module does

The payroll calculator uses configurable effective-dated withholding rules. The default set includes the post-2023 TRAIN/Annex E daily, weekly, semi-monthly and monthly tables, the annualized table and the ₱90,000 annual 13th-month/other-benefits ceiling. De minimis ceilings (RR 11-2018, then RR 29-2025 from January 6, 2026) are in `src/features/payroll/deMinimis.ts`; minimum wage earners are exempt when their daily rate is at or below the statutory minimum wage set in Payroll Settings. The audit of 21 October 2026, its fixes and the items for accountant review are in [withholding-tax/](withholding-tax/). Administrators can edit or add dated rule versions in **Payroll Settings**. Every saved payroll result carries its rule identifier/source and a calculation breakdown; subsequent runs use approved same-year payroll history, not duplicate rows in the deductions module.

The ordinary-period method selects the applicable Annex E bracket using taxable regular compensation, then applies the bracket's base tax and marginal rate to total taxable regular plus supplementary compensation. The engine switches to cumulative-average withholding when regular compensation is under the zero-withholding range, supplementary compensation is at least regular compensation, or a prior cumulative-average case must continue. A December 31 payroll, and a separated employee's last pay, annualizes current-year taxable compensation (every approved run of the year ending on or before that cutoff's last day, including 13th month runs), determines annual tax from the TRAIN annual table, and offsets recorded prior withholding; a negative balance is retained as a refund/credit adjustment.

Employee SSS, PhilHealth and Pag-IBIG contributions are calculated using the existing configured payroll contribution settings and deducted once from compensation/taxable pay. Withholding tax is calculated by the tax engine; it is not taken from the legacy manual `withholdingTax` input field. Gross compensation includes supplementary pay and separately entered benefits once.

## Payroll operator inputs

- Classify compensation as regular, supplementary (overtime, bonuses and other taxable additions), 13th-month/other benefits, and other eligible exempt benefits. Keep excluded benefits out of taxable earnings; do not enter the same amount in multiple input fields.
- Non-taxable allowances from Compensation Planning are capped automatically for the de minimis types (rice subsidy, laundry, uniform/clothing, medical); the excess counts toward the ₱90,000 exemption, and other allowance types are taxed as regular pay. `Eligible tax-exempt benefits` typed in Review Payroll is still entered as an already-verified exempt amount.
- For a new hire with another employer in the current calendar year, enter that employer's verified year-to-date taxable compensation (after mandatory contributions and eligible exclusions), 13th-month/other benefits paid, tax withheld, and payroll-period count in the review table. Repeat those same source totals for later runs in the year. Do not include these amounts in the current payroll's gross pay.
- Approve runs before their withholding is included in later-period history. Pending runs are displayed as estimates. Historical payroll runs without saved tax breakdowns are labelled as recalculated with the current rules rather than represented as their original saved calculation.

## Official authorities reviewed

1. [Republic Act No. 10963 (TRAIN)](https://www.officialgazette.gov.ph/2017/12/19/republic-act-no-10963/), including the revised individual graduated income-tax schedule effective 2023 onward.
2. [BIR Revenue Regulations No. 11-2018 (official BIR digest)](https://bir-cdn.bir.gov.ph/local/pdf/Digest%20RR%2011-2018.pdf), Section 2.78.1: Annex E from January 1, 2023; taxable compensation classification; daily/weekly/semi-monthly/monthly method; cumulative-average method; and annualized year-end/termination computation.
3. [BIR Revenue Regulations No. 8-2018 (official BIR digest)](https://bir-cdn.bir.gov.ph/local/pdf/Digest%20RR%208-2018_copy.pdf), including the graduated compensation tax schedule effective January 1, 2023 and onward.
4. [BIR Revenue Regulations No. 29-2025 (official BIR PDF)](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf), amending de minimis ceilings. The rule reference records its 2026-01-06 effective date and the listed monthly, annual, semi-annual, daily-meal and leave-day ceilings.
5. [BIR withholding tax on compensation page and calculator](https://www.bir.gov.ph/WithHoldingTax) and [BIR compensation withholding calculator](https://web-services.bir.gov.ph/tax_calculator/wt_calculator.html).

The source PDFs and Annex E were checked while implementing the tables. BIR/legislation may issue later amendments; administrators should add a new dated rule version when a subsequent issuance becomes applicable, and confirm any de minimis effective date against the actual publication/effectivity clause.

## Verification performed

The automated tests cover bracket calculations across payroll periods, effective-rule validation, regular/supplementary treatment, cumulative-average withholding, the annual ₱90,000 benefit cap, contribution subtraction, and year-end liability less withholding to date. The project's complete test suite and production build should be run for every change to the rules engine.
