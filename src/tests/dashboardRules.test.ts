import {describe,expect,it} from 'vitest';
import {departmentBreakdown,pendingApprovals} from '../../backend-render/dashboardRules.js';

const admin={id:'u-admin',role:'admin'},hr={id:'u-hr',role:'hr_staff'},finance={id:'u-fin',role:'finance'},nobody={id:'x',role:'employee'};
const run=(id:string,status:string,preparedById='u-hr')=>({id,status,preparedById,rows:[]});
const data={
 claims:[{approvalStatus:'Pending Approval'},{approvalStatus:'Approved'},{approvalStatus:'Returned'},{status:'Pending'}],
 proposals:[{status:'Pending HR Review',created_by:'u-hr'},{status:'Pending HR Review',created_by:'u-hr2'},{status:'Pending HR Review',created_by:'u-admin'}],
 runs:[run('a','Pending Approval'),run('b','Pending Approval','u-fin'),run('c','Approved'),run('d','Funded'),run('e','Exported'),run('f','Paid')],
 hmo:{enrollments:2,dependents:1},
};
const byKey=(rows:ReturnType<typeof pendingApprovals>)=>Object.fromEntries(rows.map(row=>[row.key,[row.count,row.action,row.link]]));

describe('Pending approvals per role',()=>{
 it('Admin: claims, payroll to fund, runs awaiting export or payment, HMO to view',()=>{
  expect(byKey(pendingApprovals(admin,data))).toEqual({
   claims:[2,'Review','/claims-reimbursement/claims?status=pending'],
   'payroll-funding':[1,'Review','/payroll?status=Approved'],
   'payroll-payment':[2,'View','/payroll?status=Funded,Exported'],
   hmo:[3,'View','/hmo-benefits/hmo/employee-enrollment?status=pending'],
  });
 });
 it('HR: claims to verify, payroll to fund (Finance page), runs awaiting export or payment, HMO to view',()=>{
  const rows=pendingApprovals(hr,data);
  expect(byKey(rows)).toEqual({
   claims:[2,'Review','/claims-reimbursement/claims?status=pending'],
   'payroll-funding':[1,'Review','/payroll?status=Approved'],
   'payroll-payment':[2,'View','/payroll?status=Funded,Exported'],
   hmo:[3,'View','/hmo-benefits/hmo/employee-enrollment?status=pending'],
  });
  expect(rows.find(row=>row.key==='claims')?.detail).toBe('2 claims to verify');
 });
 it('Finance: payroll to approve (never a run they prepared) and to fund',()=>{
  expect(byKey(pendingApprovals(finance,data))).toEqual({
   'payroll-approval':[1,'Review','/payroll?status=Pending%20Approval'],
   'payroll-funding':[1,'Review','/payroll?status=Approved'],
  });
 });
 it('a role without permissions gets no rows (the card is hidden)',()=>{
  expect(pendingApprovals(nobody,data)).toEqual([]);
 });
 it('counts zero when nothing is pending',()=>{
  expect(pendingApprovals(admin,{}).every(row=>row.count===0)).toBe(true);
 });
});

describe('Employees by department',()=>{
 const people=(department:string|null,count:number,status='Active')=>Array.from({length:count},()=>({department,status}));
 it('counts only active employees, puts no department under Unassigned and adds percentages to 100',()=>{
  const result=departmentBreakdown([...people('Engineering',1),...people('Finance',1),...people('',1),...people('HR',3,'Inactive')]);
  expect(result.total).toBe(3);
  expect(result.slices.map(slice=>[slice.name,slice.count,slice.percent])).toEqual([['Engineering',1,34],['Finance',1,33],['Unassigned',1,33]]);
 });
 it('keeps the top 5 departments and groups the rest as Other',()=>{
  const result=departmentBreakdown([...people('A',10),...people('B',8),...people('C',6),...people('D',5),...people('E',4),...people('F',2),...people('G',1)]);
  expect(result.slices.map(slice=>slice.name)).toEqual(['A','B','C','D','E','Other']);
  expect(result.slices[result.slices.length-1]).toMatchObject({count:3,departments:2});
  expect(result.slices.reduce((total,slice)=>total+slice.percent,0)).toBe(100);
 });
 it('is empty with no active employees',()=>{
  expect(departmentBreakdown([...people('A',2,'Inactive')])).toEqual({total:0,slices:[]});
 });
});

import {employeeOverview} from '../../backend-render/dashboardRules.js';
describe('Employee overview',()=>{
 const staff=[
  {status:'Active',employment_status:'Regular'},{status:'Active',employment_status:'Probationary'},
  {status:'Inactive',employment_status:'Contractual'},{status:'On Leave',employment_status:'Part-Time'},
  {status:'Inactive',employment_status:'Resigned'},{status:'Active',employment_status:'On Leave'},{status:'Active',employment_status:null},
 ];
 it('puts every employee in one record status and one employment type, so both sections add up to the total',()=>{
  const overview=employeeOverview(staff);
  const counts=(list:{name:string;count:number}[])=>Object.fromEntries(list.map(item=>[item.name,item.count]));
  expect(overview.total).toBe(7);
  expect(counts(overview.recordStatus)).toEqual({Active:3,Inactive:1,'On Leave':2,Resigned:1});
  expect(counts(overview.employmentType)).toEqual({Regular:1,Probationary:1,'Part-Time':1,Contractual:1,'Project-Based':0,Temporary:0,'Not recorded':3});
  for(const section of [overview.recordStatus,overview.employmentType])expect(section.reduce((total,item)=>total+item.count,0)).toBe(7);
 });
 it('lists only the six employment types (plus Not recorded), never On Leave or Resigned',()=>{
  expect(employeeOverview([]).employmentType.map(item=>item.name)).toEqual(['Regular','Probationary','Part-Time','Contractual','Project-Based','Temporary','Not recorded']);
 });
});
