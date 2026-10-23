// Salary grades with step progression, shared by the frontend (Salary Structure) and the server (a new hire's first
// salary). Rates are daily. HR edits the grades in Compensation; they are saved under GRADE_STRUCTURE_KEY in app data.
import { PAY_GRADES, positionGrade } from './positionCatalog.js';

export const GRADE_STRUCTURE_KEY = 'compensation:grade-steps';
// HR's per-position changes to the catalog: { [catalog position]: { grade?, marketRate? } }.
export const POSITION_GRADES_KEY = 'compensation:position-grades';
export const STEP_COUNT = 5;
const DEFAULT_NAMES = { G1: 'Entry / Support', G2: 'Skilled Staff', G3: 'Professional / Coordinator', G4: 'Supervisory', G5: 'Managerial' };

/** Five steps from a starting daily rate, each the given percent above the one before, in whole pesos. */
export function stepsFrom(start, increment = 5) {
  return Array.from({ length: STEP_COUNT }, (_, i) => Math.round(start * (1 + increment / 100) ** i));
}

/** The grades before HR edits them: the position catalog's rates as step 1, steps 5% apart, market rate at midpoint. */
export function defaultGrades() {
  return PAY_GRADES.map(grade => {
    const steps = stepsFrom(grade.dailyRate);
    return { code: grade.code, name: DEFAULT_NAMES[grade.code] ?? '', steps, marketRate: Math.round((steps[0] + steps[STEP_COUNT - 1]) / 2) };
  });
}

const validGrade = g => g && typeof g.code === 'string' && g.code.trim() && Array.isArray(g.steps) && g.steps.length === STEP_COUNT
  && g.steps.every((step, i) => Number.isFinite(step) && step > 0 && (i === 0 || step >= g.steps[i - 1]));
/** The saved grades when they are valid, otherwise the defaults. Every catalog grade is always present. */
export function gradeStructure(saved) {
  const rows = Array.isArray(saved) ? saved.filter(validGrade).map(g => ({ code: g.code.trim(), name: String(g.name ?? ''), steps: g.steps.map(Number),
    marketRate: Number(g.marketRate) > 0 ? Number(g.marketRate) : Math.round((g.steps[0] + g.steps[STEP_COUNT - 1]) / 2) })) : [];
  const missing = defaultGrades().filter(d => !rows.some(r => r.code === d.code));
  return [...rows, ...missing].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export const midpoint = grade => (grade.steps[0] + grade.steps[STEP_COUNT - 1]) / 2;
/** Range spread: how far the top step is above the first, in percent. */
export const spread = grade => Math.round((grade.steps[STEP_COUNT - 1] / grade.steps[0] - 1) * 100);

/** A position's grade code: HR's saved grade when there is one, otherwise the catalog's. Null outside the catalog. */
export function positionGradeCode(position, overrides) {
  const entry = positionGrade(position);
  if (!entry) return null;
  const saved = overrides && typeof overrides === 'object' ? overrides[entry.position]?.grade : undefined;
  return typeof saved === 'string' && saved.trim() ? saved.trim() : entry.grade;
}

/** A new hire's daily rate: step 1 of their position's grade, or null when the position has no grade. */
export function startingDailyRate(position, saved, overrides) {
  const entry = positionGrade(position);
  if (!entry) return null;
  const structure = gradeStructure(saved), code = positionGradeCode(position, overrides);
  return (structure.find(g => g.code === code) ?? structure.find(g => g.code === entry.grade))?.steps[0] ?? entry.dailyRate;
}
