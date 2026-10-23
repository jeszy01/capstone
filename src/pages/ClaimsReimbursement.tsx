import {Navigate,useNavigate,useSearchParams} from 'react-router-dom';
import {FileText,HandCoins} from 'lucide-react';
import {Tabs} from '../components/common/ui';
import Claims from './Claims';
import Reimbursement from './Reimbursement';

export type ClaimsSection='claims'|'reimbursement';
export const claimsTabs=[
 {id:'claims',label:'Claims',shortLabel:'Claims',icon:FileText,to:'/claims-reimbursement/claims'},
 {id:'reimbursement',label:'Reimbursement',shortLabel:'Reimbursement',icon:HandCoins,to:'/claims-reimbursement/reimbursement'},
] as const;

// Claims is one sidebar link; Claims and Reimbursement are tabs on the page. Each one reloads the
// shared claim records when opened, so newly approved claims appear under Reimbursement.
export default function ClaimsReimbursement({section}:{section:ClaimsSection}){
 const navigate=useNavigate();
 return <div className="space-y-5">
  <Tabs label="Claims sections" tabs={claimsTabs} value={section} onChange={id=>navigate(claimsTabs.find(tab=>tab.id===id)?.to??'/claims-reimbursement/claims')} idPrefix="claims-tab" panelId="claims-panel" className="mt-0"/>
  <div id="claims-panel" role="tabpanel" aria-labelledby={`claims-tab-${section}`}>{section==='claims'?<Claims/>:<Reimbursement/>}</div>
 </div>;
}

/** Sends /claims-reimbursement and the old ?tab=... links to the matching tab. */
export function ClaimsReimbursementRedirect(){
 const [params]=useSearchParams();
 return <Navigate to={params.get('tab')==='reimbursement'?'/claims-reimbursement/reimbursement':'/claims-reimbursement/claims'} replace/>;
}
