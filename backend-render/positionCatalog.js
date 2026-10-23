// The company's positions, their departments and salary grades. Shared by the frontend (Employee form, Salary
// Structure) and the server (a new hire's first salary).
// Each grade's daily range spans its positions' market rates, 5% either side, never below the NCR minimum wage.
export const PAY_GRADES = [
  { code: 'G1', dailyRate: 755, maxRate: 845 },
  { code: 'G2', dailyRate: 755, maxRate: 1015 },
  { code: 'G3', dailyRate: 790, maxRate: 1075 },
  { code: 'G4', dailyRate: 1030, maxRate: 1540 },
  { code: 'G5', dailyRate: 1960, maxRate: 2365 },
];

// marketRate: the daily market rate, from Indeed Philippines average monthly salaries (October 2026) divided by 22 working
// days, and never below the NCR minimum wage (₱755 a day, Wage Order NCR-28). HR can change it in Salary Structure.
export const POSITIONS = [
  { position: 'Rider', department: 'Fleet and Transportation', grade: 'G1', marketRate: 804 },
  { position: 'Warehouse Helper', department: 'Supply Chain', grade: 'G1', marketRate: 755 },
  { position: 'Utility Staff', department: 'Facilities', grade: 'G1', marketRate: 755 },
  { position: 'Dispatcher', department: 'Fleet and Transportation', grade: 'G2', marketRate: 799 },
  { position: 'Driver', department: 'Fleet and Transportation', grade: 'G2', marketRate: 794 },
  { position: 'Warehouse Staff', department: 'Supply Chain', grade: 'G2', marketRate: 755 },
  { position: 'Customer Support', department: 'E-Commerce Support', grade: 'G2', marketRate: 965 },
  { position: 'Records Clerk', department: 'Facilities and Admin', grade: 'G2', marketRate: 765 },
  { position: 'HR Staff', department: 'HR', grade: 'G3', marketRate: 904 },
  { position: 'Accounting Staff', department: 'Finance', grade: 'G3', marketRate: 838 },
  { position: 'Procurement Staff', department: 'Supply Chain', grade: 'G3', marketRate: 834 },
  { position: 'Fleet Coordinator', department: 'Fleet and Transportation', grade: 'G3', marketRate: 1025 },
  { position: 'Warehouse Supervisor', department: 'Supply Chain', grade: 'G4', marketRate: 1083 },
  { position: 'Fleet Supervisor', department: 'Fleet and Transportation', grade: 'G4', marketRate: 1155 },
  { position: 'Finance Supervisor', department: 'Finance', grade: 'G4', marketRate: 1469 },
  { position: 'HR Manager', department: 'HR', grade: 'G5', marketRate: 2062 },
  { position: 'Finance Manager', department: 'Finance', grade: 'G5', marketRate: 2254 },
  { position: 'Operations Manager', department: 'E-Commerce Operations', grade: 'G5', marketRate: 2065 },
];

export const DEPARTMENTS = [...new Set(POSITIONS.map(p => p.department))].sort((a, b) => a.localeCompare(b));

// Older position titles still on employee records, and the catalog position each one is.
const FORMER_TITLES = { 'accountant': 'Accounting Staff', 'hr officer': 'HR Staff', 'hr specialist': 'HR Staff', 'procurement officer': 'Procurement Staff' };

/** The catalog entry for a position (case-insensitive, former titles included) with its grade's daily rate, or null. */
export function positionGrade(position) {
  const raw = String(position ?? '').trim().toLowerCase(), key = (FORMER_TITLES[raw] ?? raw).toLowerCase();
  const entry = POSITIONS.find(p => p.position.toLowerCase() === key);
  const grade = entry && PAY_GRADES.find(g => g.code === entry.grade);
  return entry && grade ? { ...entry, dailyRate: grade.dailyRate } : null;
}
