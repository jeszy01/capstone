import {useSearchParams} from 'react-router-dom';
import {PageHeader,Tabs} from '../components/common/ui';
import Claims from './Claims';
import Reimbursement from './Reimbursement';

const TABS=[{id:'claims',label:'Claims'},{id:'reimbursement',label:'Reimbursement'}] as const;
type TabId=(typeof TABS)[number]['id'];

// Each tab reloads the shared claim records when opened, so newly approved claims appear under Reimbursement.
export default function ClaimsReimbursement(){
 const [params,setParams]=useSearchParams();
 const tab:TabId=params.get('tab')==='reimbursement'?'reimbursement':'claims';
 return <div>
  <PageHeader title="Claims & Reimbursement" description="File employee claims, review approvals and track reimbursement payouts."/>
  <Tabs label="Claims & Reimbursement sections" value={tab} onChange={next=>setParams(next==='claims'?{}:{tab:next},{replace:true})} tabs={TABS}/>
  <div className="mt-4">{tab==='claims'?<Claims/>:<Reimbursement/>}</div>
 </div>;
}
