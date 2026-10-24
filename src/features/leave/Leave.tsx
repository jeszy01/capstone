import {useEffect,useState} from 'react';
import {Check,Plus,Search,X} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {findAttendanceEmployee} from '../attendance/attendanceState';
import {getCurrentUser} from '../auth/authService';
import {can} from '../auth/permissions';
import {recordAudit} from '../audit/auditService';
import {isPaidLeave,leaveDays,leaveStatuses,leaveTypes,loadLeaves,overlaps,saveLeaves} from './leaveService';
import type {LeaveRecord,LeaveType} from './leaveService';
import {StatusBadge} from '../../components/common/StatusBadge';

const head='border-b border-gray-100 bg-gray-50/80 text-[10px] uppercase tracking-wide text-gray-500';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const shortDate=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

// HR Staff encode, approve and reject leave; an Admin views it. Approvals are logged by the server.
export default function Leave(){
 const[employees,setEmployees]=useState<Employee[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const[leaves,setLeaves]=useState<LeaveRecord[]>(loadLeaves),[q,setQ]=useState(''),[status,setStatus]=useState('');
 const[adding,setAdding]=useState(false),[deciding,setDeciding]=useState<{leave:LeaveRecord;status:'Approved'|'Rejected'}|null>(null);
 const canEncode=can('leave.encode'),canApprove=can('leave.approve');
 const load=()=>{setLoading(true);setError('');employeeService.getAll().then(setEmployees).catch(cause=>setError(cause instanceof Error&&cause.message?cause.message:'Employee records could not be loaded.')).finally(()=>setLoading(false))};
 useEffect(load,[]);
 const employeeFor=(id:string)=>findAttendanceEmployee(employees,id);
 const shown=leaves.filter(item=>{const employee=employeeFor(item.employeeId);return(!q||`${employee?.name??''} ${employee?.employeeNo??item.employeeId}`.toLowerCase().includes(q.toLowerCase()))&&(!status||item.status===status)}).sort((a,b)=>b.from.localeCompare(a.from));
 const persist=(next:LeaveRecord[])=>{saveLeaves(next);setLeaves(next)};
 const add=(leave:LeaveRecord)=>{persist([...loadLeaves(),leave]);const employee=employeeFor(leave.employeeId);recordAudit({action:'Filed leave',module:'Leave',description:`Filed ${leave.leaveType} leave for ${employee?.name??leave.employeeId}, ${leave.from} to ${leave.to} (${leave.days} day${leave.days===1?'':'s'}).`});setAdding(false)};
 const decide=()=>{if(!deciding)return;const {leave,status:next}=deciding;persist(loadLeaves().map(item=>item.id===leave.id&&item.status==='Pending'?{...item,status:next,decidedAt:new Date().toISOString(),decidedBy:getCurrentUser()?.name??''}:item));setDeciding(null)};
 const headers=['Employee','Leave Type','From','To','Days','Paid/Unpaid','Status','Actions'];
 return <div className="space-y-1">
  <PageHeader title="Leave" actions={canEncode&&<Button disabled={loading||!employees.length} onClick={()=>setAdding(true)}><Plus size={15}/>Add Leave</Button>}/>
  <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-white p-4 shadow-sm">
   <div className="flex min-w-[210px] flex-1 items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-3 max-sm:min-w-full"><Search size={16} className="text-gray-400"/><input aria-label="Employee Search" placeholder="Search employee..." value={q} onChange={event=>setQ(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"/></div>
   <select aria-label="Leave status filter" className={`${input} !w-auto min-w-[150px] !py-3 max-sm:flex-1`} value={status} onChange={event=>setStatus(event.target.value)}><option value="">All Status</option>{leaveStatuses.map(value=><option key={value} value={value}>{value}</option>)}</select>
  </div>
  {error&&<ErrorAlert title="Employee records unavailable." onRetry={load}>{error}</ErrorAlert>}
  <Card className="mt-4 overflow-hidden border-gray-200/80 p-0 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4"><h2 className="m-0 text-[14px] font-semibold text-gray-900">Leave Records</h2><span className="rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700">{status||'All Status'}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[13px]"><thead><tr className={head}>{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>
   {loading?<tr><td colSpan={headers.length}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={headers.length}><Empty>{leaves.length?'No leave records match this search.':'No leave records yet.'}</Empty></td></tr>:shown.map(item=>{const employee=employeeFor(item.employeeId);return <tr key={item.id} className="border-b border-gray-100 transition-colors hover:bg-blue-50/40">
    <td className="px-4 py-3"><div className="font-semibold text-gray-800">{employee?.name??item.employeeId}</div><div className="text-[11px] text-gray-500">{employee?.employeeNo??''}</div></td>
    <td className="px-4 py-3">{item.leaveType}</td><td className="whitespace-nowrap px-4 py-3">{shortDate(item.from)}</td><td className="whitespace-nowrap px-4 py-3">{shortDate(item.to)}</td>
    <td className="px-4 py-3 tabular-nums">{item.days}</td><td className="px-4 py-3">{item.paid?'Paid':'Unpaid'}</td>
    <td className="px-4 py-3"><StatusBadge status={item.status}/></td>
    <td className="px-4 py-3">{canApprove&&item.status==='Pending'?<div className="flex gap-2"><Button onClick={()=>setDeciding({leave:item,status:'Approved'})}><Check size={14}/>Approve</Button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} onClick={()=>setDeciding({leave:item,status:'Rejected'})}><X size={14}/>Reject</button></div>:<span className="text-[12px] text-gray-400">—</span>}</td>
   </tr>})}
  </tbody></table></div></Card>
  {adding&&<LeaveModal employees={employees} onClose={()=>setAdding(false)} onSave={add}/>}
  {deciding&&<ConfirmDialog title={deciding.status==='Approved'?'Approve leave?':'Reject leave?'} message={`${deciding.status==='Approved'?'Approve':'Reject'} ${deciding.leave.leaveType} leave for ${employeeFor(deciding.leave.employeeId)?.name??deciding.leave.employeeId}, ${shortDate(deciding.leave.from)} to ${shortDate(deciding.leave.to)}?`} confirmLabel={deciding.status==='Approved'?'Approve':'Reject'} danger={deciding.status==='Rejected'} saving={false} onCancel={()=>setDeciding(null)} onConfirm={decide}/>}
 </div>;
}

function LeaveModal({employees,onClose,onSave}:{employees:Employee[];onClose:()=>void;onSave:(leave:LeaveRecord)=>void}){
 const[f,setF]=useState({employeeId:'',leaveType:leaveTypes[0] as LeaveType,from:today(),to:today()});
 const days=leaveDays(f.from,f.to);
 const problem=!f.employeeId?'Select an employee.':f.to<f.from?'The end date must be on or after the start date.':!days?'These dates have no work days; weekends and non-working holidays are not leave days.':overlaps(loadLeaves(),f.employeeId,f.from,f.to)?'This employee already has leave on these dates.':'';
 const active=employees.filter(employee=>employee.status==='Active');
 const save=()=>{if(problem)return;onSave({id:crypto.randomUUID(),employeeId:f.employeeId,leaveType:f.leaveType,from:f.from,to:f.to,days,paid:isPaidLeave(f.leaveType),status:'Pending',createdAt:new Date().toISOString(),createdBy:getCurrentUser()?.name??''})};
 return <Modal title="Add Leave" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2">
  <div className="sm:col-span-2"><Field label="Employee"><select className={input} value={f.employeeId} onChange={event=>setF({...f,employeeId:event.target.value})}><option value="">Select employee</option>{active.map(employee=><option key={employee.id} value={employee.id}>{employee.name} ({employee.employeeNo})</option>)}</select></Field></div>
  <Field label="Leave Type"><select className={input} value={f.leaveType} onChange={event=>setF({...f,leaveType:event.target.value as LeaveType})}>{leaveTypes.map(type=><option key={type} value={type}>{type}</option>)}</select></Field>
  <Field label="Paid/Unpaid"><TextInput value={isPaidLeave(f.leaveType)?'Paid':'Unpaid'} readOnly/></Field>
  <Field label="From"><TextInput type="date" value={f.from} onChange={event=>setF({...f,from:event.target.value})}/></Field>
  <Field label="To"><TextInput type="date" value={f.to} min={f.from} onChange={event=>setF({...f,to:event.target.value})}/></Field>
  <Field label="Days"><TextInput value={String(days)} readOnly/></Field>
 </div>
 {f.employeeId&&problem&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{problem}</p>}
 <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button disabled={Boolean(problem)} onClick={save}>Save</Button></div></Modal>;
}
