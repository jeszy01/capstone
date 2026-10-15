import {afterEach,describe,expect,it,vi} from 'vitest';

const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}));
vi.mock('../services/api/apiClient',()=>({apiClient:api}));

import {compensationService} from '../features/compensation/compensationService';

afterEach(()=>vi.clearAllMocks());

const emptyBundle={salary_grades:[],assignments:[],proposals:[],history:[],rewards:[],legacy_import_complete:true,legacy_import_counts:{skipped:0}};

describe('compensationService',()=>{
 it('imports existing synchronized compensation data once before loading normalized records',async()=>{
  let reads=0;
  api.get.mockImplementation(async(path:string)=>{
   if(path==='/app-data')return {data:[{key:'compensation:employee-assignments',value:[{id:'legacy-1'}],deleted:false}]};
   reads++;
   return {data:{...emptyBundle,legacy_import_complete:reads>1}};
  });
  api.post.mockResolvedValue({data:{alreadyImported:false,counts:{assignments:1,skipped:0}}});

  const loaded=await compensationService.load();

  expect(api.post).toHaveBeenCalledWith('/compensation',{action:'import_legacy',legacy_data:{'compensation:employee-assignments':[{id:'legacy-1'}]}});
  expect(api.get).toHaveBeenNthCalledWith(2,'/app-data');
  expect(loaded.assignments).toEqual([]);
  expect(loaded.legacyImportWarning).toBe('');
 });

 it('maps normalized salary, assignment, proposal, history, and reward rows to UI types',async()=>{
  api.get.mockResolvedValue({data:{
   salary_grades:[{id:'grade-1',grade:'SAL-001',position:'Developer',monthly_salary:'55000',daily_rate:'2500',status:'Active',created_at:'2026-01-01T00:00:00Z'}],
   assignments:[{id:'assignment-1',employee_id:'employee-1',salary_code:'SAL-001',position:'Developer',basic_salary:'55000',daily_rate:'2500',effective_date:'2026-01-01'}],
   proposals:[{id:'proposal-1',employee_id:'employee-1',proposal_type:'Merit Increase',previous_salary:'55000',new_salary:'60000',effective_date:'2026-12-01',notes:'Review',status:'Approved',created_at:'2026-01-01T00:00:00Z',reviewed_by:'user-1'}],
   history:[{id:'history-1',employee_id:'employee-1',source:'Compensation Proposal',event_type:'Approved',previous_salary:'55000',new_salary:'60000',adjustment_amount:'5000',reason:'Review',effective_date:'2026-12-01',status:'Scheduled',recorded_at:'2026-01-01T00:00:00Z',actor_name:'HR User',proposal_id:'proposal-1'}],
   rewards:[{id:'reward-1',employee_id:'employee-1',reward_type:'Bonus',amount:'2500',effective_date:'2026-12-15',notes:'Year-end',status:'Approved',created_at:'2026-01-01T00:00:00Z'}],
   legacy_import_complete:true,legacy_import_counts:{skipped:0},
  }});

  const loaded=await compensationService.load();

  expect(loaded.grades[0]).toMatchObject({code:'SAL-001',fixedSalary:55000,dailyRate:2500});
  expect(loaded.assignments[0]).toMatchObject({employeeId:'employee-1',fixedSalary:55000,dailyRate:2500});
  expect(loaded.proposals[0]).toMatchObject({newSalary:60000,status:'Approved',reviewedBy:'user-1'});
  expect(loaded.history[0]).toMatchObject({actorName:'HR User',proposalId:'proposal-1'});
  expect(loaded.bonuses[0]).toMatchObject({employeeId:'employee-1',type:'Bonus',amount:2500,status:'Approved',cutoffEnd:'2026-12-15'});
 });
 it('maps pre-migration allowance and adjustment rows to active or inactive allowances',async()=>{
  api.get.mockResolvedValue({data:{...emptyBundle,rewards:[
   {id:'reward-a',employee_id:'employee-1',reward_type:'Adjustment',amount:'1200',effective_date:'2026-01-01',notes:'',status:'Approved',created_at:'2026-01-01T00:00:00Z'},
   {id:'reward-b',employee_id:'employee-1',reward_type:'Incentive',amount:'800',effective_date:'2026-01-10',notes:'Target',status:'Planned',created_at:'2026-01-01T00:00:00Z'},
  ]}});
  const loaded=await compensationService.load();
  expect(loaded.bonuses[0]).toMatchObject({type:'Allowance',allowanceType:'Adjustment',status:'Active'});
  expect(loaded.bonuses[1]).toMatchObject({type:'Incentive',status:'Pending'});
 });
 it('sends allowance and bonus payloads with their own fields',async()=>{
  api.post.mockResolvedValue({data:{}});
  const base={employeeId:'employee-1',amount:1000,effectiveDate:'2026-10-01',notes:'',status:'Active' as const,allowanceType:'Meal',frequency:'Monthly' as const,taxable:true,cutoffStart:'2026-10-01',cutoffEnd:'2026-10-15'};
  await compensationService.createReward({...base,type:'Allowance'});
  expect(api.post).toHaveBeenCalledWith('/compensation',{action:'create_reward',employee_id:'employee-1',reward_type:'Allowance',allowance_type:'Meal',frequency:'Monthly',amount:1000,effective_date:'2026-10-01',status:'Active',notes:''});
  await compensationService.updateReward('reward-1',{...base,type:'Bonus',notes:'Target met',taxable:false});
  expect(api.post).toHaveBeenCalledWith('/compensation',{action:'update_reward',id:'reward-1',employee_id:'employee-1',reward_type:'Bonus',amount:1000,cutoff_start:'2026-10-01',cutoff_end:'2026-10-15',notes:'Target met',taxable:false});
  await compensationService.reviewReward('reward-1','reject');
  expect(api.post).toHaveBeenCalledWith('/compensation',{action:'review_reward',id:'reward-1',decision:'reject'});
 });

	it('saves without a client code and displays the generated code after refreshing server data',async()=>{
	 const savedGrade={id:'grade-2',grade:'SG-002',position:'Project Manager',monthly_salary:72000,daily_rate:3272.73,status:'Active',created_at:'2026-10-11T00:00:00Z'};
	 api.post.mockResolvedValue({data:savedGrade});
	 const saved=await compensationService.createGrade({position:'Project Manager',fixedSalary:72000,status:'Active'});
	 expect(saved.grade).toBe('SG-002');
	 expect(api.post).toHaveBeenCalledWith('/compensation',{action:'create_grade',position:'Project Manager',basic_salary:72000,status:'Active'});
	 api.get.mockResolvedValue({data:{...emptyBundle,salary_grades:[savedGrade]}});
	 const refreshed=await compensationService.load();
	 expect(refreshed.grades[0]).toMatchObject({id:'grade-2',code:'SG-002',position:'Project Manager',fixedSalary:72000});
	});
	it('sends grade edits and deletes using the stable salary-grade ID',async()=>{
	 api.post.mockResolvedValue({data:{id:'grade-2'}});
	 await compensationService.updateGrade('grade-2',{position:'Project Manager',fixedSalary:75000});
	 expect(api.post).toHaveBeenCalledWith('/compensation',{action:'update_grade',id:'grade-2',position:'Project Manager',basic_salary:75000});
	 await compensationService.deleteGrade('grade-2');
	 expect(api.post).toHaveBeenCalledWith('/compensation',{action:'delete_grade',id:'grade-2'});
	});
	it('surfaces normalized codes and skipped legacy rows instead of hiding them',async()=>{
	 api.get.mockResolvedValue({data:{...emptyBundle,legacy_import_counts:{skipped:2,grade_codes_normalized:1}}});
	 const loaded=await compensationService.load();
  expect(loaded.legacyImportWarning).toContain('1 legacy salary-grade code was normalized (SG-01 to SG-001)');
  expect(loaded.legacyImportWarning).toContain('2 legacy compensation records could not be imported because required fields or a matching employee record were missing');
  expect(loaded.legacyImportWarning).toContain('remain preserved in app-data');
 });
});
