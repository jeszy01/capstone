import type {Employee} from '../../types/domain';

/** True when a Probationary employee was hired more than six months before `today` (YYYY-MM-DD). The status is not changed. */
export function probationOverdue(employee:Pick<Employee,'employmentStatus'|'dateHired'>,today:string){
 const hired=/^(\d{4})-(\d{2})-(\d{2})/.exec(employee.dateHired??'');
 if(employee.employmentStatus!=='Probationary'||!hired)return false;
 const limit=new Date(Date.UTC(Number(hired[1]),Number(hired[2])-1+6,1));
 const lastDay=new Date(Date.UTC(limit.getUTCFullYear(),limit.getUTCMonth()+1,0)).getUTCDate();
 limit.setUTCDate(Math.min(Number(hired[3]),lastDay));
 return today>limit.toISOString().slice(0,10);
}
