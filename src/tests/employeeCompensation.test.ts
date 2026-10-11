import {afterEach,describe,expect,it,vi} from 'vitest';

const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}));
vi.mock('../services/api/apiClient',()=>({apiClient:api}));

import {employeeService} from '../features/employees/employeeService';

const employee={id:'employee-1',employeeNo:'E-001',name:'Avery Sample',email:'avery@example.test',position:'Analyst',department:'Finance',dateHired:'2026-01-15',basicSalary:72000,positionRate:85000,status:'Active' as const};

function stubStorage(){
 const values=new Map<string,string>();
 vi.stubGlobal('localStorage',{
  getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,value:string)=>{values.set(key,String(value))},
  removeItem:(key:string)=>{values.delete(key)},
 });
}

afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()});

describe('employee compensation API mapping',()=>{
 it('does not write compensation values through employee creation, but reads authoritative server values',async()=>{
  stubStorage();
  api.post.mockResolvedValue({data:{id:'employee-1',employee_number:'E-001',first_name:'Avery',last_name:'Sample',hire_date:'2026-01-15',status:'Active',basic_salary:72000,position_rate:85000}});

  const created=await employeeService.create(employee);

  expect(api.post).toHaveBeenCalledWith('/employees',expect.not.objectContaining({basic_salary:expect.anything(),position_rate:expect.anything()}));
  expect(created).toMatchObject({basicSalary:72000,positionRate:85000});
 });

 it('does not allow employee updates to bypass compensation approval',async()=>{
  stubStorage();
  api.put.mockResolvedValue({data:{id:'employee-1'}});

  await employeeService.update({...employee,basicSalary:73500,positionRate:86000});

  expect(api.put).toHaveBeenCalledWith('/employees/employee-1',expect.not.objectContaining({basic_salary:expect.anything(),position_rate:expect.anything()}));
 });
});
