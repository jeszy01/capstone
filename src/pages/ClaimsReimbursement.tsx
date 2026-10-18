import {Navigate,useSearchParams} from 'react-router-dom';
import Claims from './Claims';
import Reimbursement from './Reimbursement';

export type ClaimsSection='claims'|'reimbursement';

// Claims and Reimbursement are separate submodules in the sidebar. Each one reloads the shared claim records
// when opened, so newly approved claims appear under Reimbursement.
export default function ClaimsReimbursement({section}:{section:ClaimsSection}){
 return section==='claims'?<Claims/>:<Reimbursement/>;
}

/** Sends the old /claims-reimbursement?tab=... links to the matching submodule. */
export function ClaimsReimbursementRedirect(){
 const [params]=useSearchParams();
 return <Navigate to={params.get('tab')==='reimbursement'?'/claims-reimbursement/reimbursement':'/claims-reimbursement/claims'} replace/>;
}
