import {describe,expect,it} from 'vitest';
import {appDataEvents,keepMissingRuns} from '../../backend-render/accessRules.js';
import {canMove,cutoffPayDate,runStatus} from '../../backend-render/payrollFlow.js';
import {financeStatus,runDetail,runSummary} from '../../backend-render/financeRules.js';
import {runNextStep} from '../features/payroll/payrollRuns';

const hr={id:'u-hr',role:'hr_staff'},admin={id:'u-admin',role:'admin'};
const save=(user:{id:string;role:string},before:unknown[],after:unknown[])=>appDataEvents(user,'payroll:runs',before,after,true);
// Figures that follow the Payroll Register formulas: gross is basic pay, deductions are SSS.
const row=(empId:string,net:number)=>({input:{empId,name:empId},result:{basic:net+100,gross:net+100,sss:100,deductions:100,net}});
const draft=(patch:Record<string,unknown>={})=>({id:'r1',runType:'regular',status:'Draft',from:'2026-10-01',to:'2026-10-15',payDate:'2026-10-15',rows:[],totals:{gross:0,deductions:0,net:0},preparedBy:'HR',preparedById:'u-hr',createdAt:'2026-10-16T00:00:00.000Z',...patch});
const pendingLine=(method='Bank')=>({method,bankName:'BDO',accountNumber:'123',status:'Pending'});
const computed=(patch:Record<string,unknown>={})=>draft({status:'Computed',rows:[row('EMP-1',1000),row('EMP-2',2000)],totals:{gross:3200,deductions:200,net:3000},payouts:{'EMP-1':pendingLine(),'EMP-2':{method:'Cash',status:'Pending'}},...patch});
const pending=()=>computed({status:'Pending Approval',submittedAt:'x',submittedBy:'HR'});
const approved=()=>({...pending(),status:'Approved',decidedBy:'Admin',decidedById:'u-admin',decidedAt:'x'});
const funded=()=>({...approved(),status:'Funded',funding:{receiptId:'rc-1',fileName:'bdo-transfer.pdf',mimeType:'application/pdf',size:1000,amount:3000,uploadedAt:'x',uploadedBy:'Admin',uploadedById:'u-admin',confirmedAt:'x',confirmedBy:'Admin',confirmedById:'u-admin'}});
const exportEntry={id:'x1',method:'Bank',employees:['EMP-1'],total:1000,at:'x',by:'HR'};
const exported=()=>({...funded(),status:'Exported',exports:[exportEntry],payouts:{'EMP-1':{...pendingLine(),status:'Exported',exportId:'x1'},'EMP-2':{method:'Cash',status:'Pending'}}});

describe('a stale browser copy cannot drop payroll runs',()=>{
 it('keeps runs that are missing from the saved list and refuses removing one',async()=>{
  expect(keepMissingRuns([draft({id:'a'}),draft({id:'b'})],[draft({id:'a'})]).map(item=>item.id)).toEqual(['a','b']);
  await expect(save(hr,[draft()],[])).rejects.toThrow('cannot be deleted');
 });
});

describe('payroll run transitions are enforced by the server',()=>{
 it('HR creates a Draft prepared by themselves, then computes and submits it',async()=>{
  expect(await save(hr,[],[draft()])).toEqual([['payroll.created','Payroll','r1',expect.stringContaining('draft payroll')]]);
  await expect(save(hr,[],[draft({preparedById:'someone'})])).rejects.toThrow('Draft prepared by you');
  await expect(save(hr,[],[pending()])).rejects.toThrow('must start as a Draft');
  await expect(save(admin,[],[draft({preparedById:'u-admin'})])).rejects.toThrow('Only HR Staff');
  expect((await save(hr,[draft()],[computed()]))[0][0]).toBe('payroll.computed');
  expect((await save(hr,[computed()],[computed({rows:[row('EMP-1',1500),row('EMP-2',2000)]})]))[0][0]).toBe('payroll.recomputed');
  expect((await save(hr,[computed()],[pending()]))[0][0]).toBe('payroll.submitted');
  // Submitting takes the current payout details, but every line must stay Pending.
  const refreshed={...pending(),payouts:{'EMP-1':pendingLine(),'EMP-2':{method:'E-wallet',provider:'GCash',walletNumber:'0917',status:'Pending'}}};
  expect((await save(hr,[computed()],[refreshed]))[0][0]).toBe('payroll.submitted');
  await expect(save(hr,[computed()],[{...refreshed,payouts:{...refreshed.payouts,'EMP-2':{method:'Cash',status:'Paid'}}}])).rejects.toThrow('pending payout line');
 });
 it('refuses skipping steps and changing figures while submitting',async()=>{
  await expect(save(hr,[draft()],[pending()])).rejects.toThrow('cannot move from Draft to Pending Approval');
  await expect(save(hr,[computed()],[{...pending(),rows:[row('EMP-1',9999),row('EMP-2',2000)]}])).rejects.toThrow('cannot change its contents');
  await expect(save(hr,[draft()],[computed({payouts:{}})])).rejects.toThrow('pending payout line');
  await expect(save(hr,[draft()],[computed({rows:[{input:{empId:'EMP-1',name:'Ana'},result:{basic:1000,gross:1000,deductions:0,net:900}},row('EMP-2',2000)]})])).rejects.toThrow('do not add up');
  await expect(save(hr,[pending()],[{...pending(),rows:[row('EMP-1',1)]}])).rejects.toThrow('submitted payroll run cannot be changed');
 });
 it('only an Admin approves, never their own run, and returning or rejecting needs a comment',async()=>{
  await expect(save(hr,[pending()],[{...approved(),decidedById:'u-hr'}])).rejects.toThrow('Only an Admin');
  await expect(save(admin,[{...pending(),preparedById:'u-admin'}],[{...approved(),preparedById:'u-admin'}])).rejects.toThrow('you prepared');
  expect((await save(admin,[pending()],[approved()]))[0][0]).toBe('payroll.approved');
  await expect(save(admin,[pending()],[{...approved(),status:'Returned'}])).rejects.toThrow('comment is required');
  expect((await save(admin,[pending()],[{...approved(),status:'Returned',decisionComment:'Fix OT hours'}]))[0]).toEqual(['payroll.returned','Payroll','r1',expect.stringContaining('Fix OT hours')]);
  expect((await save(admin,[pending()],[{...approved(),status:'Rejected',decisionComment:'Wrong cutoff'}]))[0][0]).toBe('payroll.rejected');
 });
 it('a returned run is recomputed; a rejected run is locked',async()=>{
  const returned={...approved(),status:'Returned',decisionComment:'Fix OT hours'};
  expect((await save(hr,[returned],[{...returned,status:'Computed'}]))[0][0]).toBe('payroll.computed');
  const rejected={...approved(),status:'Rejected',decisionComment:'Wrong cutoff'};
  await expect(save(hr,[rejected],[{...rejected,status:'Computed'}])).rejects.toThrow('rejected payroll run is locked');
 });
 it('funding is confirmed only through the receipt upload, and export is blocked until a receipt is attached',async()=>{
  await expect(save(admin,[approved()],[funded()])).rejects.toThrow('uploading the transfer receipt');
  await expect(save(hr,[approved()],[funded()])).rejects.toThrow('uploading the transfer receipt');
  await expect(save(admin,[funded()],[{...funded(),funding:{...funded().funding,fileName:'other.pdf'}}])).rejects.toThrow('uploading the transfer receipt');
  const noReceipt={...funded(),funding:{...funded().funding,receiptId:undefined}};
  await expect(save(hr,[noReceipt],[{...exported(),funding:noReceipt.funding}])).rejects.toThrow('Attach the funding receipt');
  await expect(save(hr,[approved()],[{...exported(),funding:undefined,status:'Exported'}])).rejects.toThrow();
  await expect(save(hr,[approved()],[{...approved(),exports:[exportEntry],payouts:exported().payouts}])).rejects.toThrow('only after the payroll account is funded');
 });
 it('HR exports payouts, marks them Paid or Failed, fixes failures, and the run is Paid only when everyone is',async()=>{
  expect((await save(hr,[funded()],[exported()]))[0]).toEqual(['payroll.exported','Payroll','r1',expect.stringContaining('Bank payout file for 1 employee')]);
  await expect(save(hr,[funded()],[{...funded(),status:'Exported'}])).rejects.toThrow('first payout file');
  const failed={...exported(),payouts:{...exported().payouts,'EMP-1':{...exported().payouts['EMP-1'],status:'Failed',reason:''}}};
  await expect(save(hr,[exported()],[failed])).rejects.toThrow('needs a reason');
  const failedWithReason={...failed,payouts:{...failed.payouts,'EMP-1':{...failed.payouts['EMP-1'],reason:'Account closed'}}};
  expect((await save(hr,[exported()],[failedWithReason]))[0][0]).toBe('payroll.payout_failed');
  const fixed={...failedWithReason,payouts:{...failedWithReason.payouts,'EMP-1':{method:'E-wallet',provider:'GCash',walletNumber:'0917',status:'Pending'}}};
  expect((await save(hr,[failedWithReason],[fixed]))[0][0]).toBe('payroll.payouts_updated');
  const allPaid={...exported(),payouts:{'EMP-1':{...exported().payouts['EMP-1'],status:'Paid'},'EMP-2':{method:'Cash',status:'Paid'}}};
  await expect(save(hr,[exported()],[allPaid])).rejects.toThrow();
  const someExported={...exported(),payouts:{...exported().payouts,'EMP-1':{...exported().payouts['EMP-1'],status:'Paid'}}};
  await expect(save(hr,[exported()],[{...someExported,status:'Paid',paidAt:'x'}])).rejects.toThrow('only when every employee is Paid');
  const cashExported={...someExported,exports:[exportEntry,{id:'x2',method:'Cash',employees:['EMP-2'],total:2000,at:'x',by:'HR'}],payouts:{...someExported.payouts,'EMP-2':{method:'Cash',status:'Exported',exportId:'x2'}}};
  await save(hr,[someExported],[cashExported]);
  const paid={...cashExported,status:'Paid',paidAt:'y',paidBy:'HR',payouts:{...cashExported.payouts,'EMP-2':{...cashExported.payouts['EMP-2'],status:'Paid'}}};
  expect((await save(hr,[cashExported],[paid])).map(event=>event[0])).toEqual(['payroll.payouts_paid','payroll.paid']);
  await expect(save(hr,[paid],[{...paid,payouts:{...paid.payouts,'EMP-1':{...paid.payouts['EMP-1'],status:'Failed',reason:'late bounce'}}}])).rejects.toThrow('paid payroll run is locked');
 });
 it('payslip and close fields are set only by the server',async()=>{
  await expect(save(hr,[funded()],[{...funded(),payslipsGeneratedAt:'x'}])).rejects.toThrow('only with your passkey');
  await expect(save(hr,[funded()],[{...funded(),status:'Closed'}])).rejects.toThrow('cannot move from Funded to Closed');
 });
 it('runs paid before payout tracking read as Paid or Closed and stay locked',async()=>{
  const legacy=draft({status:'Approved',rows:[row('EMP-1',1000)],paidAt:'x',paymentMethod:'Bank Transfer'});
  expect(runStatus(legacy)).toBe('Paid');
  expect(runStatus({...legacy,releasedAt:'y'})).toBe('Closed');
  expect(runStatus(draft({status:'Approved'}))).toBe('Approved');
  await expect(save(hr,[legacy],[{...legacy,paidAt:undefined}])).rejects.toThrow('locked');
  expect(canMove('Approved','Funded')).toBe(true);
  expect(canMove('Approved','Exported')).toBe(false);
 });
});

describe('pay date',()=>{
 it('pays the 1st cutoff on the 15th and the 2nd on the last day, moved back over weekends and holidays',()=>{
  expect(cutoffPayDate('2026-10-15')).toBe('2026-10-15');
  expect(cutoffPayDate('2026-10-31')).toBe('2026-10-30');
  expect(cutoffPayDate('2026-11-15')).toBe('2026-11-13');
  expect(cutoffPayDate('2026-12-31',[{date:'2026-12-31',type:'Special Non-Working Day'},{date:'2026-12-30',type:'Regular Holiday'}])).toBe('2026-12-29');
  expect(cutoffPayDate('2026-12-31',[{date:'2026-12-31',type:'Special Working Day'}])).toBe('2026-12-31');
  expect(cutoffPayDate('2026-10-10')).toBe('2026-10-15');
 });
});

describe('payroll run next steps',()=>{
 it('names the next step for each status',()=>{
  expect(runNextStep({status:'Draft'})).toMatch('computes');
  expect(runNextStep({status:'Approved'})).toMatch('funded');
  expect(runNextStep({status:'Funded'})).toMatch('exports');
  expect(runNextStep({status:'Approved',paidAt:'x'})).toMatch('payslips');
 });
});

describe('Finance API (read-only)',()=>{
 it('lists submitted runs with funding and payout progress, and hides runs still being prepared',()=>{
  expect(financeStatus(draft())).toBeNull();
  expect(financeStatus(computed())).toBeNull();
  expect(financeStatus(pending())).toBe('pending');
  expect(financeStatus({...draft({status:'Approved',paidAt:'x',releasedAt:'y'})})).toBe('closed');
  expect(runSummary(exported())).toMatchObject({status:'exported',employees:2,funding_receipt:{file_name:'bdo-transfer.pdf'},funding_amount:3000,payouts:{pending:1,exported:1,paid:0,failed:0},totals:{net:3000}});
  expect(runDetail(exported()).rows[0]).toMatchObject({employee_no:'EMP-1',net:1000,payout_method:'Bank',payout_status:'Exported'});
 });
});
