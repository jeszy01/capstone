// Salary grades with step progression, shared by the frontend (Salary Structure) and the server (a new hire's first
// salary). Rates are daily. HR edits the grades in Compensation; they are saved under GRADE_STRUCTURE_KEY in app data.
import { PAY_GRADES, positionGrade } from './positionCatalog.js';

// v2: grades re-based on market rates; the earlier grades (compensation:grade-steps) are no longer read.
export const GRADE_STRUCTURE_KEY = 'compensation:grade-steps-v2';
// HR's per-position changes: { [position]: { grade?, marketRate?, department? } }; a department marks a position HR added.
export const POSITION_GRADES_KEY = 'compensation:position-grades';
export const STEP_COUNT = 5;
const DEFAULT_NAMES = { G1: 'Entry / Support', G2: 'Skilled Staff', G3: 'Professional / Coordinator', G4: 'Supervisory', G5: 'Managerial' };

/** Five steps from a starting daily rate, each the given percent above the one before, in whole pesos. */
export function stepsFrom(start, increment = 5) {
  return Array.from({ length: STEP_COUNT }, (_, i) => Math.round(start * (1 + increment / 100) ** i));
}

/** Five steps from min to max, the same percent apart, in whole pesos. */
export function stepsBetween(min, max) {
  return Array.from({ length: STEP_COUNT }, (_, i) => Math.round(min * (max / min) ** (i / (STEP_COUNT - 1))));
}

/** The grades before HR edits them: the catalog's range per grade, steps evenly between, market rate at midpoint. */
export function defaultGrades() {
  return PAY_GRADES.map(grade => {
    const steps = stepsBetween(grade.dailyRate, grade.maxRate);
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

/**
 * A position with HR's changes: the catalog entry with its saved grade and market rate, or a position HR added
 * (saved with a department). Null when the position is neither.
 */
export function resolvePosition(position, overrides) {
  const saved = overrides && typeof overrides === 'object' ? overrides : {};
  const entry = positionGrade(position);
  if (entry) {
    const own = saved[entry.position] ?? {};
    return { position: entry.position, department: entry.department, grade: typeof own.grade === 'string' && own.grade.trim() ? own.grade.trim() : entry.grade,
      marketRate: Number(own.marketRate) > 0 ? Number(own.marketRate) : entry.marketRate, catalogGrade: entry.grade, custom: false };
  }
  const key = String(position ?? '').trim().toLowerCase();
  const name = key && Object.keys(saved).find(item => item.trim().toLowerCase() === key && saved[item]?.department);
  if (!name) return null;
  const own = saved[name];
  return { position: name, department: String(own.department), grade: String(own.grade ?? ''), marketRate: Number(own.marketRate) > 0 ? Number(own.marketRate) : 0, catalogGrade: '', custom: true };
}

/** A position's grade code: HR's saved grade when there is one, otherwise the catalog's. Null for unknown positions. */
export const positionGradeCode = (position, overrides) => resolvePosition(position, overrides)?.grade || null;

/** A position's daily market rate: HR's saved rate, else the catalog's researched rate. Null for unknown positions. */
export const positionMarketRate = (position, overrides) => resolvePosition(position, overrides)?.marketRate ?? null;

/** A new hire's daily rate: their position's market rate, kept inside its grade's range; null when the position has no grade. */
export function startingDailyRate(position, saved, overrides) {
  const entry = resolvePosition(position, overrides);
  if (!entry) return null;
  const structure = gradeStructure(saved);
  const grade = structure.find(g => g.code === entry.grade) ?? structure.find(g => g.code === entry.catalogGrade);
  if (!grade) return entry.marketRate || null;
  return Math.min(grade.steps[STEP_COUNT - 1], Math.max(grade.steps[0], entry.marketRate || grade.steps[0]));
}
