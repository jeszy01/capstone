import {useState} from 'react';
import {Card,Empty,PageHeader,Tabs} from '../../components/common/ui';

const tabs=['SSS','PhilHealth','Pag-IBIG','Contribution History'] as const;
type GovernmentTab=typeof tabs[number];
const headers=['Employee','Employee #','Position','Contribution Period','Employee Share','Employer Share','Total','Status','Action'];

export default function GovernmentBenefits(){
 const [tab,setTab]=useState<GovernmentTab>('SSS');
 return <div><PageHeader title="Government Benefits" description="Enrollment and contribution records only. Statutory calculations and remittances remain the responsibility of Payroll."/><Tabs label="Government Benefits sections" tabs={tabs.map(t=>({id:t,label:t}))} value={tab} onChange={setTab}/><Card className="mt-4 overflow-x-auto"><div className="mb-3 text-[13px] font-semibold">{tab}</div><table className="w-full min-w-[1100px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody><tr><td colSpan={headers.length}><Empty>No {tab} contribution records available. Payroll deductions are not treated as remittances.</Empty></td></tr></tbody></table></Card></div>;
}
