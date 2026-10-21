import type {HmoDependent,HmoPlan} from './hmoTypes';

/** Approved coverage that was active with Maxicare; it still counts for cutoffs before it expired or was terminated. */
export const wasCovered=(dependent:HmoDependent)=>dependent.approvalStatus==='Approved'&&(dependent.status==='Active'||(['Expired','Terminated'].includes(dependent.status)&&dependent.maxicareStatus==='Active'));

/** The company's monthly HMO cost for one enrollment: its share of the employee premium plus each covered dependent's company share. */
export function calculateCompanyHmoShare(plan:HmoPlan,dependents:HmoDependent[]):number{
  const principal=Number(plan.employeeMonthlyPremium??0)*Number(plan.employeeCompanyShare??100)/100;
  const dependentShare=dependents.filter(wasCovered).reduce((sum,dependent)=>sum+Number(dependent.companyShare??0),0);
  return Math.round((principal+dependentShare)*100)/100;
}

export function calculateEmployeeHmoShare(plan:HmoPlan,dependents:HmoDependent[]):number{
  if(!plan.collectEmployeeShareViaPayroll)return 0;
  const principal=Number(plan.employeeMonthlyPremium??0)*Number(plan.employeeMemberShare??0)/100;
  const dependentShare=dependents.filter(wasCovered).reduce((sum,dependent)=>sum+Number(dependent.employeeShare??(dependent.companySponsored?0:plan.dependentMonthlyPremium??0)),0);
  return Math.round((principal+dependentShare)*100)/100;
}
