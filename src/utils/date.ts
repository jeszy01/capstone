/** Formats an ISO date (YYYY-MM-DD) as "Oct 16, 2026". The date is read as written, so there is no day/month swap or time-zone shift. */
export function formatDate(iso:string|null|undefined){
 const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso??'');
 if(!match)return iso||'—';
 return new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}
export const formatDateRange=(from:string,to:string)=>`${formatDate(from)} – ${formatDate(to)}`;
export const isIsoDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
