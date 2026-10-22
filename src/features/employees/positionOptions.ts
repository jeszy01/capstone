import {POSITIONS} from '../../../backend-render/positionCatalog.js';

const standardPositionOptions = POSITIONS.map(item => item.position);

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
