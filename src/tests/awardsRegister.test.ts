import {describe,expect,it} from 'vitest';
import {awardSummary,buildAwards,joinNotes,splitNotes} from '../features/compensation/awardsRegister';
import type {BonusIncentive,CompensationProposal} from '../features/compensation/compensationState';
import type {PayrollRun} from '../features/payroll/payrollRuns';

const reward=(id:string,type:'Bonus'|'Incentive',amount:number,status:BonusIncentive['status'],cutoffEnd:string,createdAt:string):BonusIncentive=>({id,employeeId:'e1',type,amount,effectiveDate:cutoffEnd,notes:joinNotes(`${type} ${id}`,'Reason'),status,createdAt,allowanceType:'',frequency:'Per Cutoff',taxable:true,cutoffStart:cutoffEnd.slice(0,8)+'01',cutoffEnd});
const merit=(id:string,status:CompensationProposal['status'],effectiveDate:string):CompensationProposal=>({id,employeeId:'e1',type:'Merit Increase',previousSalary:20000,newSalary:21600,adjustmentAmount:1600,effectiveDate,notes:'Annual merit',status,createdAt:'2026-03-01T00:00:00Z'});
const paidRun={id:'r1',from:'2026-09-01',to:'2026-09-15',status:'Paid',rows:[],totals:{gross:0,deductions:0,net:0}} as unknown as PayrollRun;

describe('bonus, incentive and merit register',()=>{
 const awards=buildAwards([
  reward('a','Incentive',12000,'Pending','2026-10-31','2026-10-22T00:00:00Z'),
  reward('b','Incentive',15000,'Pending','2026-10-31','2026-10-20T00:00:00Z'),
  reward('c','Bonus',85000,'Approved','2026-10-31','2026-10-01T00:00:00Z'),
  reward('d','Bonus',95000,'Approved','2026-09-15','2026-09-01T00:00:00Z'),
  {...reward('x','Bonus',500,'Active','2026-09-15','2026-09-01T00:00:00Z'),type:'Allowance'},
 ],[merit('m1','Approved','2026-04-01'),merit('m2','Pending HR Review','2026-11-01'),{...merit('s1','Approved','2026-04-01'),type:'Salary Adjustment'}],[paidRun],'2026-10-23');

 it('lists incentives, bonuses and merit increases (not allowances or other salary changes), newest first',()=>{
  expect(awards.map(award=>award.reference)).toEqual(['INC-2026-002','INC-2026-001','BON-2026-002','BON-2026-001','MER-2026-002','MER-2026-001']);
  expect(awards[0]).toMatchObject({type:'Incentive',title:'Incentive a',description:'Reason',status:'Pending',period:'2026-10'});
 });
 it('queues approved awards for payroll until a paid run covers their cutoff',()=>{
  expect(awards.find(award=>award.id==='c')?.status).toBe('Queued for Payroll');
  expect(awards.find(award=>award.id==='d')?.status).toBe('Paid');
  expect(awards.find(award=>award.id==='m1')).toMatchObject({type:'Merit',status:'Applied',amount:1600});
 });
 it('summarizes pending, queued, paid this year and merit uplift',()=>{
  expect(awardSummary(awards,'2026-10-23')).toEqual({pending:3,requested:28600,queued:85000,queuedCount:1,paid:95000,paidCount:1,merit:1,uplift:8});
 });
 it('lists promotion increases as promotions',()=>{
  const [row]=buildAwards([],[{...merit('p1','Pending HR Review','2026-11-01'),type:'Promotion Increase',notes:'Promotion to G2 Step 3'}],[],'2026-10-23');
  expect(row).toMatchObject({reference:'PRO-2026-001',type:'Promotion',title:'Promotion to G2 Step 3',status:'Pending',amount:1600});
 });
 it('keeps the title on the first line of the notes',()=>{
  expect(splitNotes('Campaign Incentive\nBrand campaign over-delivered','Incentive')).toEqual({title:'Campaign Incentive',description:'Brand campaign over-delivered'});
  expect(splitNotes('','Bonus')).toEqual({title:'Bonus',description:''});
 });
});
