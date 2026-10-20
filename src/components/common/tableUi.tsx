/** Today's date in the browser's time zone (YYYY-MM-DD). */
export const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

/** Formats a YYYY-MM-DD date as "Oct 3, 2026". One shared implementation lives in utils/date. */
export {formatDate} from '../../utils/date';

export const tableHead='border-b border-blue-100 bg-[#f3f8ff] text-[11px] uppercase tracking-wide text-[#536987]';
export const cell='px-4 py-3.5 align-middle';
// The global row divider is drawn on td only, so a row header cell draws its own.
export const rowHeader=`${cell} whitespace-nowrap border-b border-[#edf1f7] text-left font-semibold text-[#17345b]`;
// Card adds p-5 itself; tables in these cards run edge to edge.
export const flushCard='min-w-0 overflow-hidden border-blue-100 !p-0';
