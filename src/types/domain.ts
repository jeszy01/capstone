export type EmployeeStatus='Active'|'Inactive'|'On Leave';
export type EmploymentStatus='Regular'|'Probationary'|'Part-Time'|'Contractual'|'Project-Based'|'Temporary';
export interface User{ id:string; employeeId:string; name:string; role:'Admin'|'HR Staff' }
export interface Session{token:string;user:User}
export interface Employee{id:string;employeeNo:string;name:string;email:string|null;position:string;department:string;dateHired:string;basicSalary:number;positionRate:number;status:EmployeeStatus;employmentStatus?:EmploymentStatus}
export type AttendanceStatus='Present'|'Absent'|'On Leave'|'Day Off';
export interface AttendanceRecord{id:number;empId:string;name:string;date:string;status:AttendanceStatus;timeIn:string;timeOut:string}
export interface AttendanceSchedule{start:string;end:string;otMin:number}
export interface PayrollRates{hoursPerDay:number;daysPerMonth:number;otMultiplier:number;otRestMultiplier:number;sssRate:number;sssMin:number;sssMax:number;philRate:number;philMin:number;philMax:number;pagibigRate:number;pagibigMax:number}
export interface PayrollInput{id?:number;empId:string;name:string;dailyRate:number|string;daysWorked:number|string;absentDays:number|string;lateMin:number|string;undertimeMin:number|string;otHours:number|string;otRestHours:number|string;vlDays:number|string;slDays:number|string;lwopDays:number|string;holidayPay:number|string;slConversion:number|string;transportation:number|string;riceSubsidy:number|string;otherEarnings:number|string;withholdingTax:number|string;sssLoan:number|string;pagibigLoan:number|string;companyLoan:number|string;cashAdvance:number|string;otherDeductions:number|string}
export interface PayrollResult{basic:number;overtime:number;leavePay:number;earnings:number;gross:number;late:number;undertime:number;lateUt:number;sss:number;phil:number;pagibig:number;tax:number;loans:number;deductions:number;net:number}
export interface StoredRecord{id:number;[key:string]:unknown}
export interface ApiErrorShape{message:string;status?:number}
