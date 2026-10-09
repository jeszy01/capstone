import {useState} from 'react';
import {Card,Empty} from '../../components/common/ui';

const tabs=['SSS','PhilHealth','Pag-IBIG','Contribution History'] as const;
type GovernmentTab=typeof tabs[number];
const headers=['Employee','Employee #','Position','Contribution Period','Employee Share','Employer Share','Total','Status','Action'];

export default function GovernmentBenefits(){
 const [tab,setTab]=useState<GovernmentTab>('SSS');
 return <div><h1 className="m-0 text-[22px] font-semibold">Government Benefits</h1><p className="mt-1 max-w-[650px] text-[12.5px] text-[#6b7794]">Enrollment and contribution records only. Statutory calculations and remittances remain the responsibility of Payroll.</p><div className="mt-5 flex flex-wrap gap-2 border-b border-[#e3e7ef] pb-3" role="tablist" aria-label="Government Benefits sections">{tabs.map(t=><button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)} className={`rounded-lg px-3 py-2 text-[13px] font-semibold ${tab===t?'bg-[#2f6b86] text-white':'text-[#6b7794] hover:bg-[#f6f8fb]'}`}>{t}</button>)}</div><Card className="mt-4 overflow-x-auto"><div className="mb-3 text-[13px] font-semibold">{tab}</div><table className="w-full min-w-[1100px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody><tr><td colSpan={headers.length}><Empty>No {tab} contribution records available. Payroll deductions are not treated as remittances.</Empty></td></tr></tbody></table></Card></div>;
}
