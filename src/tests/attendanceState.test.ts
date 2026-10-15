import {describe,expect,it} from 'vitest';
import type {Employee} from '../types/domain';
import {findAttendanceEmployee} from '../features/attendance/attendanceState';
import {fetchAttendance} from '../features/attendance/attendanceService';

const employee:Employee={id:'employee-jes-borbon',employeeNo:'EMP-0042',name:'Jes Borbon',email:null,position:'Engineer',department:'Engineering',dateHired:'2025-01-02',basicSalary:0,positionRate:0,status:'Active'};

describe('attendance employee references',()=>{
  it('resolves employees by either server ID or employee number',()=>{
    expect(findAttendanceEmployee([employee],employee.id)?.name).toBe('Jes Borbon');
    expect(findAttendanceEmployee([employee],employee.employeeNo)?.id).toBe(employee.id);
  });
});

describe('attendance service',()=>{
  it('returns no records until HR2 is connected',async()=>{
    expect(await fetchAttendance({from:'2026-10-01',to:'2026-10-15'})).toEqual([]);
  });
});
