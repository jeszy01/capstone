import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Pencil,Plus} from 'lucide-react';
import {Card,ConfirmDialog,Field,PageHeader,ghost,input} from '../components/common/ui';
import {can} from '../features/auth/permissions';
import {employeeService} from '../features/employees/employeeService';
import {employeePositionOptions} from '../features/employees/positionOptions';
import {loadThirteenthMonthRules} from '../features/payroll/thirteenthMonth';
import {ContributionsSection,HolidaySection,PayScheduleSection,ThirteenthMonthSection,WithholdingSection,WorkingTimeSection} from '../features/settings/SettingsEditors';
import type {SectionProps} from '../features/settings/SettingsEditors';
import {DEFAULT_WITHHOLDING_RULES,loadWithholdingRules,ruleForDate} from '../features/payroll/withholdingTax';
import {loadRates,loadRunOptions,loadTimeSettings} from '../features/settings/payrollSettings';
import {peso} from '../utils/storage';

// Read-only reference of the payroll rules. Every value is read from the saved settings, so it shows what payroll uses.
type Table={title:string;columns:string[];rows:string[][]};
type SectionId='time'|'schedule'|'holiday'|'contributions'|'withholding'|'benefits';
const SECTIONS:Array<{id:SectionId;label:string}>=[
 {id:'time',label:'Working Time & Overtime'},{id:'schedule',label:'Pay Schedule'},{id:'holiday',label:'Holiday Pay'},
 {id:'contributions',label:'Government Contributions'},{id:'withholding',label:'Withholding Tax'},{id:'benefits',label:'Benefits'},
];
const SETTING=['Setting','Value','Basis'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

const pct=(multiplier:number)=>`${Math.round(multiplier*1000)/10}%`;
const whole=(value:number)=>`₱${value.toLocaleString('en-PH')}`;
const ordinal=(day:number)=>`${day}${[11,12,13].includes(day%100)?'th':['th','st','nd','rd'][day%10]??'th'}`;
const clock=(time:string)=>{const[h,m]=time.split(':').map(Number);const hour=h%12||12;return `${hour}${m?`:${String(m).padStart(2,'0')}`:''} ${h<12?'AM':'PM'}`};
const today=()=>new Date().toISOString().slice(0,10);

function tables(section:SectionId):Table[]{
 const rates=loadRates(),time=loadTimeSettings();
 // Hours past 8 on a premium day add 30% of the day's rate (Labor Code Art. 87).
 const over=(first:number)=>pct(first*1.3);
 if(section==='time')return [
  {title:'Working time',columns:SETTING,rows:[
   ['Hours per day',String(rates.hoursPerDay),'Labor Code Art. 83'],
   ['Meal break','60 minutes','Art. 85'],
   ['Daily rate divisor',`${rates.daysPerMonth} days per month`,'DOLE rate factors'],
   ['Night differential',`+${rates.ndRate}% (${clock(time.ndStart)} to ${clock(time.ndEnd)})`,'Art. 86'],
   ['NCR minimum wage',rates.statutoryMinimumWage?`${whole(rates.statutoryMinimumWage)} per day`:'Not set','Wage Order NCR-28'],
  ]},
  {title:'Overtime rates',columns:['Day type','First 8 hours','Over 8 hours','Basis'],rows:[
   ['Ordinary day','100%',pct(rates.otMultiplier),'Art. 87'],
   ['Rest day or special day',pct(rates.holidaySpecialWorked),pct(rates.otRestMultiplier),'Art. 93'],
   ['Regular holiday',pct(rates.holidayRegularWorked),over(rates.holidayRegularWorked),'Art. 94'],
   ['Regular holiday on rest day',pct(rates.holidayRegularRestDay),over(rates.holidayRegularRestDay),'Art. 94'],
   ['Special day on rest day',pct(rates.holidaySpecialRestDay),over(rates.holidaySpecialRestDay),'Art. 93'],
  ]},
 ];
 if(section==='schedule'){
  const semi=rates.payPeriodsPerMonth===2,end=rates.firstCutoffEndDay,end2=rates.secondCutoffEndDay;
  const payDay=(day:number)=>day>=28?'last day (30th/31st)':ordinal(day);
  const start=end2>=28?'1st':`${ordinal(end2+1)} of the previous month`,last=end2>=28?'end of month':ordinal(end2);
  return [{title:'Pay schedule',columns:SETTING,rows:semi?[
   ['Frequency','Semi-monthly','Art. 103'],
   ['First cutoff',`${start} to ${ordinal(end)}, paid on ${payDay(rates.firstPayDay)}`,'Art. 103'],
   ['Second cutoff',`${ordinal(end+1)} to ${last}, paid on ${payDay(rates.secondPayDay)}`,'Art. 103'],
   ['Weekend or holiday','Paid the working day before','Art. 103'],
  ]:[
   ['Frequency','Monthly','Art. 103'],
   ['Cutoff',`${start} to ${last}, paid on ${payDay(rates.secondPayDay)}`,'Art. 103'],
   ['Weekend or holiday','Paid the working day before','Art. 103'],
  ]}];
 }
 if(section==='holiday')return [{title:'Holiday pay',columns:['Day type','Not worked','Worked','Basis'],rows:[
  ['Regular holiday',rates.holidayRegularUnworked?pct(rates.holidayRegularUnworked):'No pay',pct(rates.holidayRegularWorked),'Art. 94'],
  ['Special non-working day','No pay',pct(rates.holidaySpecialWorked),'Art. 93'],
  ['Special working day','No pay',pct(rates.holidaySpecialWorking),'Yearly proclamation'],
 ]}];
 if(section==='contributions')return [{title:'Contributions',columns:['Contribution','Employee','Employer','Limits','Basis'],rows:[
  ['SSS',`${rates.sssRate}%`,`${rates.sssEmployerRate}%`,`Credit ${whole(rates.sssMin)} to ${whole(rates.sssMax)}`,'RA 11199'],
  ['SSS EC','None',`${whole(rates.sssEcLow)} or ${whole(rates.sssEcHigh)}`,`Below or above ${whole(rates.sssEcThreshold)}`,'PD 626'],
  ['PhilHealth',`${rates.philRate}%`,`${rates.philEmployerRate}%`,`Salary ${whole(rates.philMin)} to ${whole(rates.philMax)}`,'RA 11223'],
  ['Pag-IBIG',`${rates.pagibigRate}%`,`${rates.pagibigEmployerRate}%`,`Fund salary up to ${whole(rates.pagibigMax)}`,'RA 9679'],
 ]}];
 if(section==='withholding'){
  const rule=ruleForDate(today(),loadWithholdingRules()),basis=rule.id===DEFAULT_WITHHOLDING_RULES.id?'RR 11-2018':rule.source;
  return [
   {title:'Tax setting',columns:SETTING,rows:[
    ['Tax column in Payroll Register',loadRunOptions().showTax?'On':'Off','Company workflow'],
    ['13th month tax-free up to',whole(rule.annualBenefitsExemption),'RA 10963'],
   ]},
   {title:'Monthly tax table',columns:['Monthly pay over','Base tax','Plus rate on excess','Basis'],rows:rule.tables.monthly.map(row=>[whole(row.over),row.base?peso(row.base):'₱0',`${row.rate}%`,basis])},
  ];
 }
 const rules=loadThirteenthMonthRules(),months=rules.minimumServiceMonths;
 const who=`Rank-and-file with ${months}+ month${months===1?'':'s'} of service`;
 const excluded=[rules.excludeOvertime&&'overtime',(rules.excludeHolidayPay||rules.excludeNightDifferential)&&'premiums',rules.excludeAllowances&&'allowances'].filter(Boolean).join(', ');
 const[month,day]=rules.releaseDeadline.split('-').map(Number);
 return [
  {title:'Benefits',columns:['Benefit','Formula','Who gets it','Basis'],rows:[
   ['13th month pay','Basic salary earned in the year ÷ 12',who,'PD 851'],
   ['Service incentive leave','5 paid days a year, unused days paid as daily rate × unused days','1+ year of service','Art. 95'],
   ['Maternity leave','105 days, SSS benefit plus employer salary differential','Female employees','RA 11210'],
   ['Paternity leave','7 days × daily rate','Married male employees','RA 8187'],
   ['Solo parent leave','7 days × daily rate','Solo parents with ID and 6+ months of service','RA 8972'],
   ['De minimis (rice, uniform, medical)','Fixed amount, tax-free up to the BIR limit, excess is taxable','Per company policy','BIR rules'],
  ]},
  {title:'13th month pay',columns:SETTING,rows:[
   ['Formula','Basic salary earned in the year ÷ 12','PD 851'],
   ['Not included',excluded?excluded[0].toUpperCase()+excluded.slice(1):'None','PD 851 IRR'],
   ['Who gets it',who,'PD 851'],
   ['Pay by',`${MONTHS[month-1]??''} ${day||''}${rules.allowInstallments?` (${rules.installments} installments)`:''}`.trim(),'PD 851'],
  ]},
  {title:'Bonuses and incentives',columns:SETTING,rows:[
   ['Amount','Fixed peso amount per employee','Company policy'],
   ['Period','Added to the cutoff it belongs to','Company policy'],
   ['Approval','Reviewed before payroll, the encoder cannot approve','Company workflow'],
   ['Tax','Taxable unless marked non-taxable','RA 10963'],
  ]},
 ];
}

export default function PayrollSettings(){
 const navigate=useNavigate();
 const canEdit=can('settings.edit');
 const [section,setSection]=useState<SectionId>('time');
 // An Admin edits one section at a time; 'new' opens Withholding Tax on a new version.
 const [editing,setEditing]=useState<false|'edit'|'new'>(false);
 const [dirty,setDirty]=useState(false);
 const [leave,setLeave]=useState<(()=>void)|null>(null);
 const [notice,setNotice]=useState('');
 const [positions,setPositions]=useState<string[]>([]);
 useEffect(()=>{if(!canEdit)return;employeeService.getAll().then(rows=>setPositions(employeePositionOptions(rows.map(row=>row.position)))).catch(()=>setPositions(employeePositionOptions([])))},[canEdit]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(timer)},[notice]);
 // Leaving with unsaved changes asks to discard: section switches, in-app links and closing the tab.
 const guard=(action:()=>void)=>{if(editing&&dirty)setLeave(()=>action);else{setEditing(false);action()}};
 useEffect(()=>{
  if(!dirty)return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
  const click=(event:MouseEvent)=>{
   const link=(event.target as HTMLElement|null)?.closest('a[href]') as HTMLAnchorElement|null;
   if(!link||link.target==='_blank')return;
   const url=new URL(link.href);
   if(url.origin!==window.location.origin||url.pathname===window.location.pathname)return;
   event.preventDefault();event.stopPropagation();
   setLeave(()=>()=>navigate(url.pathname+url.search));
  };
  window.addEventListener('beforeunload',unload);document.addEventListener('click',click,true);
  return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',click,true)};
 },[dirty,navigate]);
 const props:SectionProps={editing:true,canEdit:true,onEdit:()=>undefined,onDone:message=>{setEditing(false);setDirty(false);if(message)setNotice(message)},onDirty:setDirty};
 const open=(id:SectionId)=>{if(id!==section)guard(()=>setSection(id))};
 return <div>
  <PageHeader title="Payroll Settings"/>
  {notice&&<p role="status" className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
  <div className="mt-6 grid gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
   <div className="sm:hidden"><Field label="Section"><select className={input} value={section} onChange={event=>open(event.target.value as SectionId)}>{SECTIONS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>
   <nav aria-label="Payroll settings sections" className="hidden sm:block"><ul className="m-0 grid list-none gap-1 p-0">{SECTIONS.map(item=><li key={item.id}><button type="button" aria-current={section===item.id?'page':undefined} onClick={()=>open(item.id)} className={`w-full rounded-xl px-3.5 py-2.5 text-left text-[13px] font-medium transition ${section===item.id?'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-600/30':'text-gray-600 hover:bg-gray-100'}`}>{item.label}</button></li>)}</ul></nav>
   <div className="min-w-0 space-y-6">
    {editing?<>
     {section==='time'&&<WorkingTimeSection {...props}/>}
     {section==='schedule'&&<PayScheduleSection {...props}/>}
     {section==='holiday'&&<HolidaySection {...props} calendarLocked={false}/>}
     {section==='contributions'&&<ContributionsSection {...props}/>}
     {section==='withholding'&&<WithholdingSection {...props} startNew={editing==='new'}/>}
     {section==='benefits'&&<ThirteenthMonthSection {...props} positions={positions}/>}
    </>:<>
     {canEdit&&<div className="flex flex-wrap justify-end gap-2">{section==='withholding'&&<button type="button" className={ghost} onClick={()=>setEditing('new')}><Plus size={15}/>New version</button>}<button type="button" className={ghost} onClick={()=>setEditing('edit')}><Pencil size={15}/>Edit</button></div>}
     {tables(section).map(table=><Card key={table.title} className="min-w-0">
      <h2 className="m-0 mb-4 text-[17px] font-semibold text-gray-900">{table.title}</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[520px] text-left text-[13px]">
       <thead><tr className="border-b bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">{table.columns.map(column=><th key={column} className="px-4 py-3">{column}</th>)}</tr></thead>
       <tbody>{table.rows.map((row,index)=><tr key={index} className="border-b border-gray-100 last:border-0">{row.map((cell,i)=><td key={i} className={`px-4 py-3 ${i===0?'font-medium text-gray-800':i===row.length-1?'text-[12px] text-gray-500':'text-gray-700'}`}>{cell}</td>)}</tr>)}</tbody>
      </table></div>
     </Card>)}
    </>}
   </div>
  </div>
  {leave&&<ConfirmDialog title="Discard changes?" message="Leave without saving your changes?" confirmLabel="Discard" danger saving={false} onCancel={()=>setLeave(null)} onConfirm={()=>{const action=leave;setLeave(null);setEditing(false);setDirty(false);action()}}/>}
 </div>;
}
