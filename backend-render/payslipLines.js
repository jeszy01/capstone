// The lines of an employee's payslip, from a saved payroll run row: earnings, and deductions in groups. The PBMS payslip
// and the payslip released to ESS both use it. Only lines with an amount are listed; amounts are the saved figures.
//   Time not paid: absences, late, undertime
//   Government contributions: SSS, PhilHealth, Pag-IBIG (employee shares)
//   Tax: withholding tax
//   Loans: each government loan, then the SSS, Pag-IBIG and company loans and the cash advance recorded in PBMS
//   Other deductions: HMO dependents, then each other deduction (or their total, for runs computed before items were kept)

const n = v => Number(v) || 0;
const r2 = v => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const sum = values => r2(values.reduce((total, value) => total + r2(value), 0));
const listed = lines => lines.map(([label, amount]) => ({ label, amount: r2(amount) })).filter(line => line.amount !== 0);

/** Earnings with an amount, in payslip order. */
export function earningLines(row) {
  const input = row?.input ?? {}, result = row?.result ?? {};
  return listed([
    ['Basic Salary', result.basic], ['Overtime', result.overtime], ['Night Differential', input.nightDifferential],
    ['Leave Pay', result.leavePay], ['Holiday Pay', input.holidayPay], ['Service Incentive Leave Conversion', input.slConversion],
    ['Allowances', result.allowances], ['Incentives & Bonuses', n(input.otherEarnings) + n(input.bonusesNonTaxable)],
    ['13th-Month and Other Benefits', input.thirteenthMonthAndOtherBenefits], ['Eligible Tax-Exempt Benefits', input.taxExemptBenefits],
  ]);
}

/**
 * The loan lines. Runs saved before government loans had their own fields kept them in the SSS and Pag-IBIG loan
 * fields; those amounts are moved to the government loan lines so nothing is counted twice.
 */
function loanLines(row) {
  const input = row?.input ?? {}, government = Array.isArray(row?.governmentLoans) ? row.governmentLoans : [];
  const separate = input.govSssLoan !== undefined || input.govPagibigLoan !== undefined;
  const of = type => sum(government.filter(loan => loan.loanType === type).map(loan => loan.amount));
  const governmentLines = government.length ? government.map(loan => [`${loan.loanType} Loan`, loan.amount])
    : [['SSS Loan', input.govSssLoan], ['Pag-IBIG Loan', input.govPagibigLoan]];
  return listed([
    ...governmentLines,
    ['SSS Loan', separate ? input.sssLoan : n(input.sssLoan) - of('SSS')],
    ['Pag-IBIG Loan', separate ? input.pagibigLoan : n(input.pagibigLoan) - of('Pag-IBIG')],
    ['Company Loan', input.companyLoan], ['Cash Advance', input.cashAdvance],
  ]);
}

/** Other deductions: each item kept with the row when they add up to the row's total, otherwise the total. */
function otherLines(row) {
  const total = r2(row?.input?.otherDeductions), items = Array.isArray(row?.otherDeductionItems) ? row.otherDeductionItems : [];
  const itemized = items.length > 0 && sum(items.map(item => item.amount)) === total;
  return listed([['HMO Dependents', row?.hmo], ...(itemized ? items.map(item => [item.label, item.amount]) : [['Other Deductions', total]])]);
}

/** The payslip's deduction groups that have an amount, each with its lines and subtotal. */
export function deductionGroups(row) {
  const result = row?.result ?? {};
  return [
    ['Time not paid', listed([['Absences', result.absences], ['Late', result.late], ['Undertime', result.undertime]])],
    ['Government contributions', listed([['SSS', result.sss], ['PhilHealth', result.phil], ['Pag-IBIG', result.pagibig]])],
    ['Tax', listed([['Withholding Tax', result.tax]])],
    ['Loans', loanLines(row)],
    ['Other deductions', otherLines(row)],
  ].filter(([, lines]) => lines.length).map(([title, lines]) => ({ title, lines, subtotal: sum(lines.map(line => line.amount)) }));
}

/** The payslip of one row: earnings, deduction groups and their totals (the saved gross, deductions and net). */
export function payslipLines(row) {
  const result = row?.result ?? {}, groups = deductionGroups(row);
  return { earnings: earningLines(row), deductionGroups: groups, gross: r2(result.gross), totalDeductions: r2(result.deductions), net: r2(result.net),
    // 0 when the lines add up to the saved totals; otherwise the payslip shows a warning instead of hiding the difference.
    deductionsDifference: r2(n(result.deductions) - sum(groups.map(group => group.subtotal))) };
}
