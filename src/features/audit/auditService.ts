import {getCurrentUser} from '../auth/authService';
import {read,write} from '../../utils/storage';

export type AuditEvent={id:string;timestamp:string;user:string;action:string;module:string;description:string;ipDevice:string};
const auditKey='audit:events';

export function recordAudit(event:{action:string;module:string;description:string;ipDevice?:string}){
 const current=getCurrentUser();
 const entry:AuditEvent={id:crypto.randomUUID(),timestamp:new Date().toISOString(),user:current?.name||'Admin',action:event.action,module:event.module,description:event.description,ipDevice:event.ipDevice||'Browser'};
 write<AuditEvent[]>(auditKey,[...read<AuditEvent[]>(auditKey,[]),entry]);
 return entry;
}
export const readAuditEvents=()=>read<AuditEvent[]>(auditKey,[]);
