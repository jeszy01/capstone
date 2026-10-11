const standardPositionOptions = [
  'Project Manager', 'Construction Manager', 'Site Engineer', 'Civil Engineer',
  'Project Architect', 'Quantity Surveyor', 'Estimator', 'Site Supervisor',
  'General Foreman', 'Safety Officer', 'QA/QC Engineer', 'Surveyor',
  'Heavy Equipment Operator', 'Crane Operator', 'Electrician', 'Plumber',
  'Welder', 'Carpenter', 'Mason', 'Steelman', 'Construction Laborer',
  'Procurement Officer', 'Warehouse Coordinator', 'HR Officer',
  'Payroll Officer', 'Accountant', 'Administrative Assistant',
  // Positions with configured Salary Grade defaults must be selectable in both forms.
  'Software Developer', 'HR Specialist', 'Finance Manager', 'Operations Manager',
];

/**
 * Shared autocomplete options for employee Position and Salary Grade Position.
 * Existing employee titles are retained, case-insensitively de-duplicated, and
 * custom titles remain typeable in the employee form.
 */
export function employeePositionOptions(existingPositions: Array<string | null | undefined>): string[] {
  const options = new Map<string, string>();
  for (const raw of [...standardPositionOptions, ...existingPositions]) {
    const position = String(raw ?? '').trim();
    if (position && !options.has(position.toLowerCase())) {
      options.set(position.toLowerCase(), position);
    }
  }
  return [...options.values()].sort((a, b) => a.localeCompare(b));
}
