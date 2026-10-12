import {describe,expect,it} from 'vitest';
import type {AttendanceRecord,Employee} from '../types/domain';
import {canonicalAttendanceRecord,findAttendanceEmployee,hasAttendanceForEmployee} from '../features/attendance/attendanceState';

const employee:Employee={id:'employee-jes-borbon',employeeNo:'EMP-0042',name:'Jes Borbon',email:null,position:'Engineer',department:'Engineering',dateHired:'2025-01-02',basicSalary:0,positionRate:0,status:'Active'};
const record=(overrides:Partial<AttendanceRecord>={}):AttendanceRecord=>({id:1,empId:employee.id,name:employee.name,date:'2026-10-12',status:'Present',timeIn:'08:00',timeOut:'17:00',...overrides});

describe('attendance employee references',()=>{
  it('resolves employees by either server ID or employee number',()=>{
    expect(findAttendanceEmployee([employee],employee.id)?.name).toBe('Jes Borbon');
    expect(findAttendanceEmployee([employee],employee.employeeNo)?.id).toBe(employee.id);
  });

  it('canonicalizes a selected employee to the employee number used by attendance data',()=>{
    expect(canonicalAttendanceRecord(record({empId:employee.id}),[employee])).toMatchObject({empId:'EMP-0042',name:'Jes Borbon'});
  });

  it('prevents duplicate attendance when the existing row uses the other employee reference',()=>{
    const existing=record();
    const candidate=record({id:2,empId:employee.employeeNo});
    expect(hasAttendanceForEmployee([existing],candidate,[employee])).toBe(true);
  });
});
