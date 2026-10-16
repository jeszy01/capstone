import {Navigate,useSearchParams} from 'react-router-dom';
import {PageHeader} from '../components/common/ui';
import Claims from './Claims';
import Reimbursement from './Reimbursement';

export type ClaimsSection='claims'|'reimbursement';

// Claims and Reimbursement are separate submodules in the sidebar. Each one reloads the shared claim records
// when opened, so newly approved claims appear under Reimbursement.
export default function ClaimsReimbursement({section}:{section:ClaimsSection}){
 return <div>
  <PageHeader title="Claims & Reimbursement" description="File employee claims, review approvals and track reimbursement payouts."/>
  <div className="mt-5">{section==='claims'?<Claims/>:<Reimbursement/>}</div>
 </div>;
}

/** Sends the old /claims-reimbursement?tab=... links to the matching submodule. */
export function ClaimsReimbursementRedirect(){
 const [params]=useSearchParams();
 return <Navigate to={params.get('tab')==='reimbursement'?'/claims-reimbursement/reimbursement':'/claims-reimbursement/claims'} replace/>;
}
