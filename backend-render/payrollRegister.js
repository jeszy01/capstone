// The Payroll Register: one line per employee from the run's saved figures, built on the server and only displayed by
// the app. Every amount is rounded to 2 decimals and totals are the sum of the rounded lines.
//   Gross = Basic + Allowance + Bonuses/Incentives + Overtime + Holiday/Leave pay
//   Total deductions = Absences + Late/UT + SSS + PhilHealth + Pag-IBIG + HMO + Tax + Loans + Other
//   Net = Gross - Total deductions
// Tax is the withholding computed with the run (base: Gross - Absences - Late/UT - SSS - PhilHealth - Pag-IBIG, with the
// BIR exemptions). Loans = government loans + SSS loan + Pag-IBIG loan + company loan + cash advance.

const n = v => Number(v) || 0;
const r2 = v => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const sum = values => r2(values.reduce((total, value) => total + r2(value), 0));

export const REGISTER_COLUMNS = [
  ['basic', 'Basic pay'], ['allowance', 'Allowance'], ['bonuses', 'Bonuses/Incentives'], ['overtime', 'Overtime pay'],
  ['holidayLeave', 'Holiday/Leave pay'], ['gross', 'Gross pay'], ['absences', 'Absences'], ['lateUt', 'Late/UT'], ['sss', 'SSS'],
  ['philhealth', 'PhilHealth'], ['pagibig', 'Pag-IBIG'], ['hmo', 'HMO'], ['tax', 'Tax'], ['loans', 'Loans'], ['other', 'Other'],
  ['totalDeductions', 'Total deductions'], ['net', 'Net pay'],
].map(([key, label]) => ({ key, label }));
const EARNINGS = ['basic', 'allowance', 'bonuses', 'overtime', 'holidayLeave'];
const DEDUCTIONS = ['absences', 'lateUt', 'sss', 'philhealth', 'pagibig', 'hmo', 'tax', 'loans', 'other'];

/** One employee's register line from a saved run row (input, result and the HMO cutoff deduction). */
export function registerLine(row) {
  const input = row?.input ?? {}, result = row?.result ?? {};
  const line = {
    basic: r2(result.basic),
    allowance: r2(result.allowances),
    bonuses: sum([input.otherEarnings, input.bonusesNonTaxable, input.thirteenthMonthAndOtherBenefits, input.taxExemptBenefits]),
    // Night differential is a premium on hours worked, shown with overtime.
    overtime: sum([result.overtime, input.nightDifferential]),
    holidayLeave: sum([input.holidayPay, result.leavePay, input.slConversion]),
    absences: r2(result.absences),
    lateUt: sum([result.late, result.undertime]),
    sss: r2(result.sss), philhealth: r2(result.phil), pagibig: r2(result.pagibig),
    hmo: r2(row?.hmo),
    tax: r2(result.tax),
    loans: sum([input.govSssLoan, input.govPagibigLoan, input.sssLoan, input.pagibigLoan, input.companyLoan, input.cashAdvance]),
    other: r2(input.otherDeductions),
  };
  line.gross = sum(EARNINGS.map(key => line[key]));
  line.totalDeductions = sum(DEDUCTIONS.map(key => line[key]));
  line.net = r2(line.gross - line.totalDeductions);
  return { empId: String(input.empId ?? ''), name: String(input.name ?? ''), position: String(row?.position ?? ''), ...line };
}

/**
 * Why a computed row does not follow the register formulas, or '' when it does: its saved gross, deductions and net
 * must match the line built from its parts (within half a centavo, for rounding).
 */
export function registerMismatch(row) {
  const line = registerLine(row), result = row?.result ?? {};
  const off = (a, b) => Math.abs(r2(a) - r2(b)) > 0.005;
  if (off(line.gross, result.gross)) return `${line.name || line.empId}: gross pay ${r2(result.gross)} is not the sum of its earnings (${line.gross}).`;
  if (off(line.totalDeductions, result.deductions)) return `${line.name || line.empId}: total deductions ${r2(result.deductions)} is not the sum of its deductions (${line.totalDeductions}).`;
  if (off(line.net, result.net)) return `${line.name || line.empId}: net pay ${r2(result.net)} is not gross less deductions (${line.net}).`;
  return '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; };
const dateText = iso => { const { y, m, d } = day(iso); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const rangeText = (from, to) => {
  const a = day(from), b = day(to);
  if (from === to) return dateText(from);
  return a.y === b.y && a.m === b.m ? `${MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${a.y}` : `${dateText(from)} – ${dateText(to)}`;
};

/** The whole register of a run: header, columns (Tax left out when showTax is off), lines and totals. */
export function buildRegister(run, { company = 'Archon Nell Inc.', showTax = false } = {}) {
  const lines = (Array.isArray(run?.rows) ? run.rows : []).map(registerLine);
  const columns = REGISTER_COLUMNS.filter(column => showTax || column.key !== 'tax');
  const totals = Object.fromEntries(REGISTER_COLUMNS.map(({ key }) => [key, sum(lines.map(line => line[key]))]));
  return {
    company, runId: `PR-${String(run?.id ?? '').slice(0, 8).toUpperCase()}`,
    cutoff: run?.runType === 'thirteenth-month' ? `13th Month Pay · ${dateText(run.to)}` : rangeText(run?.from, run?.to),
    payDate: dateText(run?.payDate ?? run?.to), columns, lines, totals,
  };
}
