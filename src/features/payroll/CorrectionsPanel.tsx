import {useState} from 'react';
import {Card,Empty,Segmented} from '../../components/common/ui';
import {flushCard,tableHead} from '../../components/common/tableUi';

const FILTERS=[{id:'all',label:'All'},{id:'pending',label:'Pending'},{id:'approved',label:'Approved'},{id:'rejected',label:'Rejected'},{id:'completed',label:'Completed'}] as const;
type Filter=(typeof FILTERS)[number]['id'];
const HEADINGS=['Employee','Payroll period','Request','Amount','Status','Date'];

/** Payroll Runs → Corrections: correction requests filed against payroll runs, filtered by status. */
export function CorrectionsPanel(){
 const[filter,setFilter]=useState<Filter>('all');
 return <Card className={flushCard}>
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
   <h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Correction requests</h2>
   <Segmented label="Filter correction requests by status" options={FILTERS} value={filter} onChange={setFilter}/>
  </div>
  <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[13px]">
   <thead><tr className={tableHead}>{HEADINGS.map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${label==='Amount'?'text-right':''}`}>{label}</th>)}</tr></thead>
   <tbody><tr><td colSpan={HEADINGS.length}><Empty>No correction requests.</Empty></td></tr></tbody>
  </table></div>
 </Card>;
}
