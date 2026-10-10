import type {HmoDependent,HmoPlan} from './hmoTypes';

export function calculateEmployeeHmoShare(plan:HmoPlan,dependents:HmoDependent[]):number{
  if(!plan.collectEmployeeShareViaPayroll)return 0;
  const principal=Number(plan.employeeMonthlyPremium??0)*Number(plan.employeeMemberShare??0)/100;
  const dependentShare=dependents.filter(dependent=>dependent.status==='Active'&&dependent.approvalStatus==='Approved').reduce((sum,dependent)=>sum+Number(dependent.employeeShare??(dependent.companySponsored?0:plan.dependentMonthlyPremium??0)),0);
  return Math.round((principal+dependentShare)*100)/100;
}
