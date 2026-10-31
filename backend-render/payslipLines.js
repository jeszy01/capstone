// The lines of an employee's payslip, from a saved payroll run row: earnings, and deductions in groups. The PBMS payslip
// and the payslip released to ESS both use it. Only lines with an amount are listed; amounts are the saved figures.
//   Statutory Contributions: SSS, PhilHealth, Pag-IBIG (employee shares)
//   Withholding Tax: income tax (a refund at the year-end adjustment)
//   Attendance Deductions: absences, late, undertime, each with the days or minutes deducted
//   Other Deductions: each government loan, the SSS, Pag-IBIG and company loans and the cash advance recorded in PBMS,
//     HMO dependents, then each other deduction (or their total, for runs computed before items were kept)

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

const plural = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'}`;
/** Minutes as the payslip shows them: "25 minutes", "1 hour", "1 hour 30 minutes". */
export function duration(minutes) {
  const total = Math.round(n(minutes)), hours = Math.floor(total / 60), rest = total % 60;
  return [hours ? plural(hours, 'hour') : '', rest || !hours ? plural(rest, 'minute') : ''].filter(Boolean).join(' ');
}
/** Absences, late and undertime with the days and minutes deducted (the row's saved attendance figures). */
function attendanceLines(row) {
  const input = row?.input ?? {}, result = row?.result ?? {};
  return listed([
    [`Absences (${plural(n(input.absentDays), 'day')})`, result.absences],
    [`Late (${duration(input.lateMin)})`, result.late],
    [`Undertime (${duration(input.undertimeMin)})`, result.undertime],
  ]);
}

/** The payslip's deduction groups that have an amount, each with its lines and subtotal. */
export function deductionGroups(row) {
  const result = row?.result ?? {};
  return [
    ['Statutory Contributions', listed([['SSS Contribution', result.sss], ['PhilHealth Contribution', result.phil], ['Pag-IBIG Contribution', result.pagibig]])],
    ['Withholding Tax', listed([[n(result.tax) < 0 ? 'Tax Refund' : 'Income Tax', result.tax]])],
    ['Attendance Deductions', attendanceLines(row)],
    ['Other Deductions', [...loanLines(row), ...otherLines(row)]],
  ].filter(([, lines]) => lines.length).map(([title, lines]) => ({ title, lines, subtotal: sum(lines.map(line => line.amount)) }));
}

/** The payslip of one row: earnings, deduction groups and their totals (the saved gross, deductions and net). */
export function payslipLines(row) {
  const result = row?.result ?? {}, groups = deductionGroups(row);
  return { earnings: earningLines(row), deductionGroups: groups, gross: r2(result.gross), totalDeductions: r2(result.deductions), net: r2(result.net),
    // 0 when the lines add up to the saved totals; otherwise the payslip shows a warning instead of hiding the difference.
    deductionsDifference: r2(n(result.deductions) - sum(groups.map(group => group.subtotal))) };
}
