import {describe,expect,it} from 'vitest';
import {departmentBreakdown,pendingApprovals} from '../../backend-render/dashboardRules.js';

const admin={id:'u-admin',role:'admin'},hr={id:'u-hr',role:'hr_staff'},nobody={id:'x',role:'employee'};
const run=(id:string,status:string,preparedById='u-hr')=>({id,status,preparedById,rows:[]});
const data={
 claims:[{approvalStatus:'Pending Approval'},{approvalStatus:'Approved'},{approvalStatus:'Returned'},{status:'Pending'}],
 proposals:[{status:'Pending HR Review',created_by:'u-hr'},{status:'Pending HR Review',created_by:'u-hr2'},{status:'Pending HR Review',created_by:'u-admin'}],
 runs:[run('a','Pending Approval'),run('b','Pending Approval','u-admin'),run('c','Approved'),run('d','Funded'),run('e','Exported'),run('f','Paid')],
 hmo:{enrollments:2,dependents:1},
};
const byKey=(rows:ReturnType<typeof pendingApprovals>)=>Object.fromEntries(rows.map(row=>[row.key,[row.count,row.action,row.link]]));

describe('Pending approvals per role',()=>{
 it('Admin: claims, salary adjustments to review (never their own), payroll to approve and fund, HMO to view',()=>{
  expect(byKey(pendingApprovals(admin,data))).toEqual({
   claims:[2,'Review','/claims-reimbursement/claims?status=pending'],
   salary:[2,'Review','/compensation/adjustments?status=pending'],
   'payroll-approval':[1,'Review','/payroll?status=Pending%20Approval'],
   'payroll-funding':[1,'Review','/payroll?status=Approved'],
   hmo:[3,'View','/hmo-benefits/hmo/employee-enrollment?status=pending'],
  });
 });
 it('HR: claims to verify, their own proposals, runs awaiting export or payment, HMO to view; never payroll approval',()=>{
  const rows=pendingApprovals(hr,data);
  expect(byKey(rows)).toEqual({
   claims:[2,'Review','/claims-reimbursement/claims?status=pending'],
   salary:[1,'View','/compensation/adjustments?status=pending&mine=1'],
   'payroll-payment':[2,'View','/payroll?status=Funded,Exported'],
   hmo:[3,'View','/hmo-benefits/hmo/employee-enrollment?status=pending'],
  });
  expect(rows.find(row=>row.key==='claims')?.detail).toBe('2 claims to verify');
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
