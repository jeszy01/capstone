/** Today's date in the browser's time zone (YYYY-MM-DD). */
export const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

/** Formats a YYYY-MM-DD date as "Oct 3, 2026". One shared implementation lives in utils/date. */
export {formatDate} from '../../utils/date';

// Header cells take the shared table header band (index.css).
export const tableHead='';
export const cell='align-middle';
// The global row divider is drawn on td only, so a row header cell draws its own.
export const rowHeader=`${cell} whitespace-nowrap text-left`;
// Card adds p-6 itself; tables in these cards run edge to edge, in the shared table frame.
export const flushCard='min-w-0 overflow-hidden border-gray-200/80 !p-0';
