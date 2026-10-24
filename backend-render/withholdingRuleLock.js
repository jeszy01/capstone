// A withholding tax rule version that a payroll run was computed with is locked: its tables, exemption and leave
// classification cannot change and it cannot be removed. A change takes effect through a new effective-dated version,
// which may only start after the last run that used the old one. Shared by Payroll Settings and the server's
// app-data save, so the lock does not depend on the browser.

const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
// What a version computes with. The source citation and effective-to date are not part of it.
const computed = rule => canonical({
  effectiveFrom: rule.effectiveFrom,
  tables: rule.tables,
  annualTable: rule.annualTable,
  annualBenefitsExemption: rule.annualBenefitsExemption,
  paidLeaveAs: rule.paidLeaveAs ?? 'supplementary',
});
// The weekly table shipped before October 2026 had its fixed amounts shifted one bracket; loading rules repairs it.
const WRONG_WEEKLY = canonical([[0, 0, 0], [4808, 0, 15], [7692, 0, 20], [15385, 432.6, 25], [38462, 1971.2, 30], [153846, 7740.45, 35]].map(([over, base, rate]) => ({ over, base, rate })));
const OFFICIAL_WEEKLY = canonical([[0, 0, 0], [4808, 0, 15], [7692, 432.6, 20], [15385, 1971.2, 25], [38462, 7740.45, 30], [153846, 42355.65, 35]].map(([over, base, rate]) => ({ over, base, rate })));
const weeklyRepair = (before, after) => canonical(before.tables?.weekly) === WRONG_WEEKLY && canonical(after.tables?.weekly) === OFFICIAL_WEEKLY
  && computed({ ...before, tables: { ...before.tables, weekly: after.tables.weekly } }) === computed(after);

/** The version a run was computed with: the one recorded on the run, otherwise the one in effect on its last day. */
export function ruleIdForRun(run, rules) {
  if (run?.settings?.withholdingRuleId) return run.settings.withholdingRuleId;
  const date = run?.to ?? '';
  const sorted = [...rules].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return (sorted.find(rule => rule.effectiveFrom <= date && (!rule.effectiveTo || date <= rule.effectiveTo)) ?? sorted.find(rule => rule.effectiveFrom <= date))?.id;
}

/** Why saving after in place of before is refused because of the runs computed with a version; '' when allowed. */
export function lockedRuleChange(before, after, runs) {
  const old = Array.isArray(before) ? before : [], next = Array.isArray(after) ? after : [];
  const lastUse = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || run.status === 'Rejected') continue;
    const id = ruleIdForRun(run, old);
    if (id && (!lastUse.has(id) || run.to > lastUse.get(id))) lastUse.set(id, run.to);
  }
  for (const [id, lastDate] of lastUse) {
    const was = old.find(rule => rule.id === id);
    if (!was) continue;
    const now = next.find(rule => rule.id === id);
    const name = `The withholding tax version effective ${was.effectiveFrom}`;
    if (!now) return `${name} was used by payroll runs and cannot be removed.`;
    // A field an older saved version never had was read with its default, so the saved copy may fill it in.
    const filled = { ...was, tables: { ...(now.tables ?? {}), ...(was.tables ?? {}) }, annualTable: was.annualTable ?? now.annualTable, annualBenefitsExemption: was.annualBenefitsExemption ?? now.annualBenefitsExemption };
    if (computed(filled) !== computed(now) && !weeklyRepair(filled, now)) return `${name} was used by payroll runs, so it cannot be changed. Add a new version instead.`;
    if (now.effectiveTo && now.effectiveTo < lastDate) return `${name} was used by a payroll run through ${lastDate}. A new version must start after ${lastDate}.`;
  }
  return '';
}
