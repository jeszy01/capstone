# Sample employee: TEST-100 Maria Sample

One employee for checking, by hand, how PBMS computes pay, deductions and withholding tax. The expected figures below
are for the **October 10–25, 2026** cutoff with the **default Payroll Settings**. The automated test
`src/tests/exampleEmployee.test.ts` checks these same figures against the payroll engine.

## Add and remove

The script writes to the Render database, so the sample employee appears in PBMS like a real one.

```
cd backend-render
set DATABASE_URL=<Render database External Database URL>     (PowerShell: $env:DATABASE_URL="...")
node scripts/example-employee.js seed      add, or reset to the values below
node scripts/example-employee.js clean     remove the employee and their records
```

**Important:**

- A payroll run includes every active employee with a salary, so Maria Sample appears in any payroll created while she
  exists. Create the October 10–25 payroll, click **Review** to compute it, check the figures, and **do not submit it**.
  Delete the draft afterwards, then run `clean`.
- `clean` stops if a payroll run still includes TEST-100. A run that was already submitted cannot be removed; in that
  case keep the employee or set her Inactive.
- Submitting is blocked while an earlier 2026 payroll is not yet approved or rejected. Computing and reviewing is not.

## The employee

| Item | Value |
|---|---|
| Employee no. / name | TEST-100 / Maria Sample |
| Position / department | Site Engineer / Engineering, Regular, hired 2025-01-06 |
| Monthly basic salary | ₱36,000.00 |
| Daily rate | ₱36,000 ÷ 22 days = ₱1,636.36 (exact: ₱1,636.3636) |
| Hourly rate | ₱1,636.3636 ÷ 8 = ₱204.55 (exact: ₱204.5455) |
| Allowances (monthly) | Transportation ₱2,000 (taxable), Rice Subsidy ₱2,000 (non-taxable), Laundry ₱600 (non-taxable) |
| Bonus | Performance bonus ₱3,000, taxable, for October 10–25 |
| Company loan | ₱12,000, 6 installments of ₱2,000 per payroll, from October 10 |
| SSS loan | ₱1,500 a month (₱750 a cutoff), reference TEST-100-SSS |

## Attendance, October 10–25 (from HR2)

10 working days (October 12–16 and 19–23; weekends are Day Off).

| Date | Record | Effect |
|---|---|---|
| Oct 13 | Absent | 1 absent day |
| Oct 14 | Late 15 min (in 08:15) | |
| Oct 15 | Overtime 2 h, **approved** (out 19:00) | paid |
| Oct 16 | Vacation leave (paid) | 1 leave day |
| Oct 20 | Late 30 min (in 08:30) | |
| Oct 21 | Undertime 60 min (out 16:00) | |
| Oct 22 | Overtime 1 h, **approved** (out 18:00) | paid |
| Oct 23 | Overtime 1.5 h, **pending** (out 18:30) | **not paid** |

Payroll inputs: **days worked 8**, absent days 1, paid leave days 1, late 45 min, undertime 60 min, overtime 3 h.

## Expected payroll, October 10–25

### Earnings

| Line | Computation | Amount |
|---|---|---|
| Basic pay | ₱1,636.3636 × 8 days worked = ₱13,090.91, plus the absent day ₱1,636.36 (deducted below) | ₱14,727.27 |
| Overtime | ₱204.5455 × 1.25 × 3 h | ₱767.05 |
| Paid leave | ₱1,636.3636 × 1 day | ₱1,636.36 |
| Allowances | Transportation ₱1,000 + Rice ₱1,000 + Laundry ₱300 (half of each monthly amount) | ₱2,300.00 |
| Bonus | Performance bonus | ₱3,000.00 |
| **Gross pay** | | **₱22,430.68** |

### Deductions

| Line | Computation | Amount |
|---|---|---|
| Absence | 1 day × ₱1,636.36 | ₱1,636.36 |
| Late | ₱204.5455 ÷ 60 × 45 min | ₱153.41 |
| Undertime | ₱204.5455 ÷ 60 × 60 min | ₱204.55 |
| SSS | ₱36,000 salary credit capped at ₱35,000 × 5% ÷ 2 | ₱875.00 |
| PhilHealth | ₱36,000 × 2.5% ÷ 2 | ₱450.00 |
| Pag-IBIG | ₱10,000 ceiling × 2% ÷ 2 | ₱100.00 |
| Withholding tax | see below | ₱1,094.15 |
| Company loan | installment 1 of 6 | ₱2,000.00 |
| SSS loan | ₱1,500 ÷ 2 | ₱750.00 |
| **Total deductions** | | **₱7,263.47** |
| **Net pay** | ₱22,430.68 − ₱7,263.47 | **₱15,167.21** |

Employer shares (not deducted from Maria): SSS ₱1,765.00 (₱35,000 × 10% + ₱30 EC, ÷ 2), PhilHealth ₱450.00,
Pag-IBIG ₱100.00.

### Allowances: taxable or not

| Allowance | This cutoff | BIR ceiling this cutoff | Exempt | Taxable |
|---|---|---|---|---|
| Transportation | ₱1,000 | — (fixed allowance) | ₱0 | ₱1,000 regular pay |
| Rice Subsidy | ₱1,000 | ₱2,500/month ÷ 2 = ₱1,250 | ₱1,000 | ₱0 |
| Laundry | ₱300 | ₱400/month ÷ 2 = ₱200 | ₱200 | ₱100, counted toward the ₱90,000 benefits exemption |

### Withholding tax (semi-monthly table, RR 11-2018 Annex E)

| Step | Computation | Amount |
|---|---|---|
| Regular pay | Basic earned ₱14,727.27 − absence ₱1,636.36 − late ₱153.41 − undertime ₱204.55 = ₱12,732.95, + taxable allowance ₱1,000 | ₱13,732.95 |
| Supplementary pay | Overtime ₱767.05 + paid leave ₱1,636.36 + bonus ₱3,000 | ₱5,403.41 |
| Other benefits | Laundry above the ceiling ₱100, within the ₱90,000 exemption | ₱0 taxable |
| Contributions | SSS + PhilHealth + Pag-IBIG | ₱1,425.00 |
| Taxable regular pay | ₱13,732.95 − ₱1,425.00 → bracket "over ₱10,417", 15% | ₱12,307.95 |
| Total taxable pay | ₱13,732.95 + ₱5,403.41 − ₱1,425.00 | ₱17,711.36 |
| **Tax** | ₱0 + 15% × (₱17,711.36 − ₱10,417.00) | **₱1,094.15** |

The total taxable pay (₱17,711.36) is above ₱16,667, but the bracket is chosen from regular pay only (RR 11-2018
Steps 3–4), so the rate is 15%, not 20%. With the 20% bracket the tax would be ₱1,146.37. The method is the regular one,
not the cumulative average: regular pay is above the first bracket and supplementary pay is less than regular pay.

## What to check where

| Module | Check |
|---|---|
| Employees | TEST-100 Maria Sample, ₱36,000 |
| Compensation → Allowances | the three allowances; Rice Subsidy and Laundry as de minimis in Allowance Types |
| Compensation → Bonuses | ₱3,000 performance bonus, Approved, October 10–25 |
| Attendance | October 10–25 records above; the pending overtime on October 23 is not paid |
| Deductions / Loans | company loan installment ₱2,000; SSS loan ₱750 |
| Payroll → Review | the earnings, deductions and net pay above |
| Withholding Tax | regular ₱13,732.95, supplementary ₱5,403.41, taxable ₱17,711.36, tax ₱1,094.15, method "Calculated" |

## If a figure differs

The figures assume:

- Payroll Settings at their defaults: 22 days a month, 8 hours a day, overtime 1.25×, the contribution rates above,
  cutoffs ending on the 9th and 25th, and no minimum wage set at or above ₱1,636.36.
- No holiday from October 10 to 25 in the holiday calendar.
- Allowance Types still treating Rice Subsidy as rice and Laundry as laundry.
- No HMO enrollment and no other authorized deductions for TEST-100.
- Paid leave taxed as supplementary pay (the default). With "regular pay", regular pay becomes ₱15,369.31, supplementary
  ₱3,767.05, and the tax is unchanged at ₱1,094.15 (still the 15% bracket, same total).

Compare the inputs in Review Payroll (days worked, absences, minutes, overtime hours) first: a different input explains
a different amount.
