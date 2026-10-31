import {read,write} from '../../utils/storage';
import {apiClient} from '../../services/api/apiClient';
import type {BankResultRow} from './bankResult';

/** One bank result file attached to a run, stored with its cutoff and the file itself (text). */
export type StoredBankResult={id:string;runId:string;from:string;to:string;fileName:string;content:string;attachedAt:string;attachedBy:string;rows:number;paid:number;failed:number;unmatched:BankResultRow[]};
// Stored results are only added, never removed or changed (the server refuses it).
export const BANK_RESULTS_KEY='payroll:bank-results';
export const loadBankResults=()=>{const list=read<StoredBankResult[]>(BANK_RESULTS_KEY,[]);return Array.isArray(list)?list:[]};

/** Adds one result to the server's current list, so results another user stored since this page loaded are kept. */
export async function storeBankResult(entry:Omit<StoredBankResult,'id'>){
 const {data}=await apiClient.get<{data:{key:string;value:unknown;deleted?:boolean}[]}>('/app-data');
 const current=data.find(item=>item.key===BANK_RESULTS_KEY&&!item.deleted)?.value;
 const next=[...(Array.isArray(current)?current as StoredBankResult[]:[]),{id:crypto.randomUUID(),...entry}];
 const saved=await apiClient.post<{key:string;value:unknown},{data?:{value?:unknown}}>('/app-data',{key:BANK_RESULTS_KEY,value:next});
 write(BANK_RESULTS_KEY,Array.isArray(saved?.data?.value)?saved.data.value:next);
}
