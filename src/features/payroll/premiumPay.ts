import type {AttendanceRecord,PayrollRates} from '../../types/domain';
import type {Holiday,TimeSettings} from '../settings/payrollSettings';

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const minutes=(time:string)=>{const [h,m]=time.split(':').map(Number);return h*60+m};
/** A time span in minutes from midnight, moving the end to the next day when it is earlier than the start. */
const span=(start:string,end:string):[number,number]=>{const a=minutes(start);let b=minutes(end);if(b<=a)b+=1440;return [a,b]};
const overlap=([a1,a2]:[number,number],[b1,b2]:[number,number])=>Math.max(0,Math.min(a2,b2)-Math.max(a1,b1));
const worked=(record?:AttendanceRecord)=>Boolean(record&&record.timeIn&&record.timeOut&&(record.status==='Present'||record.status==='Day Off'));

/** Minutes worked inside the night differential window (the window may cross midnight). */
export function nightDifferentialMinutes(record:AttendanceRecord,time:Pick<TimeSettings,'ndStart'|'ndEnd'>){
 if(!worked(record))return 0;
 const shift=span(record.timeIn,record.timeOut),night=span(time.ndStart,time.ndEnd);
 return overlap(shift,night)+overlap(shift,[night[0]-1440,night[1]-1440])+overlap(shift,[night[0]+1440,night[1]+1440]);
}
export function nightDifferentialPay(records:AttendanceRecord[],time:Pick<TimeSettings,'ndStart'|'ndEnd'>,rates:Pick<PayrollRates,'ndRate'|'hoursPerDay'>,dailyRate:number){
 const total=records.reduce((sum,record)=>sum+nightDifferentialMinutes(record,time),0);
 return round(dailyRate/rates.hoursPerDay*rates.ndRate/100*total/60);
}

/**
 * Holiday pay for one cutoff, using the Holiday Pay multipliers and the Holiday Calendar. A "Present" day is a
 * worked regular day and is already in basic pay, so only the premium above 1x is added. A "Day Off" record with
 * time in and out is work on a rest day and is paid in full at the rest-day multiplier.
 */
export function holidayPay(records:AttendanceRecord[],holidays:Holiday[],rates:PayrollRates,dailyRate:number,from:string,to:string){
 const byDate=new Map<string,Holiday[]>();
 for(const holiday of holidays)if(holiday.date>=from&&holiday.date<=to)byDate.set(holiday.date,[...(byDate.get(holiday.date)??[]),holiday]);
 let total=0;
 for(const [date,list] of byDate){
  const record=records.find(item=>item.date===date);
  const restDay=record?.status==='Day Off',didWork=worked(record);
  const regular=list.filter(item=>item.type==='Regular Holiday').length;
  const special=list.some(item=>item.type==='Special Non-Working Day');
  if(regular>=2)total+=didWork?(restDay?rates.holidayDouble:rates.holidayDouble-1):restDay?0:rates.holidayRegularUnworked*2;
  else if(regular===1)total+=didWork?(restDay?rates.holidayRegularRestDay:rates.holidayRegularWorked-1):restDay?0:rates.holidayRegularUnworked;
  else if(special)total+=didWork?(restDay?rates.holidaySpecialRestDay:rates.holidaySpecialWorked-1):0;
  else if(didWork)total+=restDay?rates.holidaySpecialWorking:rates.holidaySpecialWorking-1;
 }
 return round(Math.max(0,total)*dailyRate);
}
