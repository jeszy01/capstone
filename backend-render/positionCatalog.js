// The company's positions, their departments and salary grades. Shared by the frontend (Employee form, Salary
// Structure) and the server (a new hire's first salary).
export const PAY_GRADES = [
  { code: 'G1', dailyRate: 755 },
  { code: 'G2', dailyRate: 850 },
  { code: 'G3', dailyRate: 1000 },
  { code: 'G4', dailyRate: 1250 },
  { code: 'G5', dailyRate: 1600 },
];

export const POSITIONS = [
  { position: 'Rider', department: 'Fleet and Transportation', grade: 'G1' },
  { position: 'Warehouse Helper', department: 'Supply Chain', grade: 'G1' },
  { position: 'Utility Staff', department: 'Facilities', grade: 'G1' },
  { position: 'Dispatcher', department: 'Fleet and Transportation', grade: 'G2' },
  { position: 'Driver', department: 'Fleet and Transportation', grade: 'G2' },
  { position: 'Warehouse Staff', department: 'Supply Chain', grade: 'G2' },
  { position: 'Customer Support', department: 'E-Commerce Support', grade: 'G2' },
  { position: 'Records Clerk', department: 'Facilities and Admin', grade: 'G2' },
  { position: 'HR Staff', department: 'HR', grade: 'G3' },
  { position: 'Accounting Staff', department: 'Finance', grade: 'G3' },
  { position: 'Procurement Staff', department: 'Supply Chain', grade: 'G3' },
  { position: 'Fleet Coordinator', department: 'Fleet and Transportation', grade: 'G3' },
  { position: 'Warehouse Supervisor', department: 'Supply Chain', grade: 'G4' },
  { position: 'Fleet Supervisor', department: 'Fleet and Transportation', grade: 'G4' },
  { position: 'Finance Supervisor', department: 'Finance', grade: 'G4' },
  { position: 'HR Manager', department: 'HR', grade: 'G5' },
  { position: 'Finance Manager', department: 'Finance', grade: 'G5' },
  { position: 'Operations Manager', department: 'E-Commerce Operations', grade: 'G5' },
];

export const DEPARTMENTS = [...new Set(POSITIONS.map(p => p.department))].sort((a, b) => a.localeCompare(b));

/** The catalog entry for a position (case-insensitive) with its grade's daily rate, or null. */
export function positionGrade(position) {
  const key = String(position ?? '').trim().toLowerCase();
  const entry = POSITIONS.find(p => p.position.toLowerCase() === key);
  const grade = entry && PAY_GRADES.find(g => g.code === entry.grade);
  return entry && grade ? { ...entry, dailyRate: grade.dailyRate } : null;
}
