import {formatWithSetting} from '../features/settings/systemSettings';
/** A YYYY-MM-DD date in the date format chosen in Settings → Regional ("Oct 3, 2026" by default). */
export function formatDate(iso:string|null|undefined){
 const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso??'');
 if(!match)return iso||'—';
 return formatWithSetting(Number(match[1]),Number(match[2]),Number(match[3]));
}
export const formatDateRange=(from:string,to:string)=>`${formatDate(from)} – ${formatDate(to)}`;
export const isIsoDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
