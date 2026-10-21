// HR2 attendance intake rules that do not need the database, so they can be tested on their own.
// The store matches the browser's attendance:hr2 shape: { receivedAt, syncedThrough, records }.

export const HR2_MAX_RECORDS = 5000;
const STATUSES = ['Present', 'Absent', 'On Leave', 'Day Off'];
const OT_STATUSES = ['Approved', 'Pending', 'Rejected'];
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v);
export const isHr2Date = isDate;
const minutes = (v, name) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1440) throw new Error(`${name} must be whole minutes from 0 to 1440`);
  return n;
};
const optionalText = v => typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null;

/** One record in the stored shape, or throws with the reason it was refused. */
function hr2Record(raw, known) {
  if (!raw || typeof raw !== 'object') throw new Error('record must be an object');
  const employeeNo = typeof raw.employee_no === 'string' ? raw.employee_no.trim() : '';
  if (!employeeNo) throw new Error('employee_no is required');
  const canonical = known.get(employeeNo.toLowerCase());
  if (!canonical) throw new Error('employee_no is not a PBMS employee');
  if (!isDate(raw.date)) throw new Error('date must be YYYY-MM-DD');
  if (!STATUSES.includes(raw.status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const timeIn = raw.time_in ?? null, timeOut = raw.time_out ?? null;
  if (timeIn !== null && !isTime(timeIn)) throw new Error('time_in must be HH:MM (24-hour) or null');
  if (timeOut !== null && !isTime(timeOut)) throw new Error('time_out must be HH:MM (24-hour) or null');
  const workedHours = raw.worked_hours === undefined || raw.worked_hours === null ? null : Number(raw.worked_hours);
  if (workedHours !== null && (!Number.isFinite(workedHours) || workedHours < 0 || workedHours > 24)) throw new Error('worked_hours must be from 0 to 24 or null');
  const otStatus = raw.ot_status ?? null;
  if (otStatus !== null && !OT_STATUSES.includes(otStatus)) throw new Error(`ot_status must be one of ${OT_STATUSES.join(', ')} or null`);
  return {
    // Stored as the PBMS employee number, so payroll matches it exactly.
    employee_no: canonical, date: raw.date, time_in: timeIn, time_out: timeOut, worked_hours: workedHours,
    late_min: minutes(raw.late_min, 'late_min'), undertime_min: minutes(raw.undertime_min, 'undertime_min'), ot_min: minutes(raw.ot_min, 'ot_min'),
    status: raw.status, leave_type: optionalText(raw.leave_type), ot_status: otStatus,
  };
}

/** Splits the received records into accepted (stored shape) and rejected ({ index, employee_no, date, reason }). */
export function validateHr2Records(records, knownEmployeeNumbers) {
  const known = new Map([...knownEmployeeNumbers].map(n => [String(n).trim().toLowerCase(), String(n).trim()]));
  const accepted = [], rejected = [];
  records.forEach((raw, index) => {
    try { accepted.push(hr2Record(raw, known)); }
    catch (cause) { rejected.push({ index, employee_no: raw?.employee_no ?? null, date: raw?.date ?? null, reason: cause.message }); }
  });
  return { accepted, rejected };
}

/**
 * Adds received records to the store: one record per employee number and date, the newest replacing the older (so
 * HR2 corrections overwrite). syncedThrough is the latest of the stored value, synced_through and the record dates;
 * payroll for a cutoff can be submitted once it reaches the cutoff's last day.
 */
export function mergeHr2Store(store, records, syncedThrough, receivedAt) {
  const key = r => `${String(r.employee_no).trim().toLowerCase()}|${r.date}`;
  const byKey = new Map((Array.isArray(store?.records) ? store.records : []).map(r => [key(r), r]));
  for (const record of records) byKey.set(key(record), record);
  const covered = [store?.syncedThrough ?? '', syncedThrough ?? '', ...records.map(r => r.date)].filter(Boolean).sort().pop() ?? null;
  return { receivedAt, syncedThrough: covered, records: [...byKey.values()] };
}
