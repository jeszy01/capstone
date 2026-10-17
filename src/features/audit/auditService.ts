import {apiClient} from '../../services/api/apiClient';

export type AuditEvent={id:string;timestamp:string;user:string;role:string;action:string;module:string;description:string;ipDevice:string};

// The server stamps each entry with the signed-in user, role, time and IP/device.
export function recordAudit(event:{action:string;module:string;description:string}){
 void apiClient.post<typeof event,unknown>('/audit-logs',event).catch(()=>undefined);
}
export const readAuditEvents=()=>apiClient.get<{data:AuditEvent[]}>('/audit-logs').then(response=>response.data);
