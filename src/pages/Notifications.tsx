import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {AlertTriangle,Banknote,Check,Clock,CreditCard,FileCheck,FileText,FileX,XCircle} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {Card,Empty,PageHeader,ghost} from '../components/common/ui';
import {markAllRead,markRead,useNotifications} from '../features/notifications/notificationService';
import type {AppNotification,NotificationType} from '../features/notifications/notificationService';

// Icon and tint per notification type.
const STYLES:Record<NotificationType,{icon:LucideIcon;tint:string}>={
 claim_submitted:{icon:FileText,tint:'bg-blue-50 text-blue-600'},
 claim_approved:{icon:FileCheck,tint:'bg-blue-50 text-blue-600'},
 claim_rejected:{icon:FileX,tint:'bg-red-50 text-red-600'},
 ot_pending:{icon:Clock,tint:'bg-orange-50 text-orange-600'},
 payroll_pending:{icon:CreditCard,tint:'bg-purple-50 text-purple-600'},
 payroll_approved:{icon:Check,tint:'bg-emerald-50 text-emerald-600'},
 payroll_rejected:{icon:XCircle,tint:'bg-red-50 text-red-600'},
 payroll_returned:{icon:AlertTriangle,tint:'bg-red-50 text-red-600'},
 payroll_funded:{icon:Banknote,tint:'bg-emerald-50 text-emerald-600'},
};

// Just now, 10m ago, 1h ago, Yesterday, then the date.
function when(iso:string){
 const date=new Date(iso),now=new Date();
 if(Number.isNaN(date.getTime()))return '—';
 const minutes=Math.floor((now.getTime()-date.getTime())/60000);
 if(minutes<1)return 'Just now';
 if(minutes<60)return `${minutes}m ago`;
 if(minutes<24*60)return `${Math.floor(minutes/60)}h ago`;
 const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
 if(date.toDateString()===yesterday.toDateString())return 'Yesterday';
 return date.toLocaleDateString('en-PH',{dateStyle:'medium'});
}

export default function Notifications(){
 const navigate=useNavigate();
 const items=useNotifications(),[filter,setFilter]=useState<'all'|'unread'>('all');
 const unread=items.filter(item=>!item.read).length;
 const shown=filter==='unread'?items.filter(item=>!item.read):items;
 const open=(item:AppNotification)=>{markRead(item.id);navigate(item.link)};
 const tab=(id:'all'|'unread',label:string)=><button type="button" aria-pressed={filter===id} onClick={()=>setFilter(id)} className={`rounded-lg border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${filter===id?'border-blue-600 bg-blue-600 text-white':'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>{label}</button>;
 return <div className="space-y-5">
  <PageHeader title="Notifications" actions={<button type="button" className={ghost} disabled={!unread} onClick={markAllRead}>Mark all as read</button>}/>
  <div className="flex gap-2">{tab('all','All')}{tab('unread',`Unread (${unread})`)}</div>
  {!shown.length?<Card><Empty>{filter==='unread'?'No unread notifications':'No notifications'}</Empty></Card>:<ul className="m-0 max-h-[68vh] list-none space-y-2.5 overflow-y-auto p-0 pr-1">{shown.map(item=>{const {icon:Icon,tint}=STYLES[item.type]??STYLES.claim_submitted;return <li key={item.id}>
   <button type="button" onClick={()=>open(item)} className={`flex w-full items-center gap-3.5 rounded-xl border px-4 py-3 text-left transition hover:shadow-sm ${item.read?'border-gray-100 bg-white':'border-blue-100 bg-blue-50/40'}`}>
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tint}`}><Icon size={16}/></span>
    <span className="min-w-0 flex-1"><span className={`block text-[13px] text-gray-900 ${item.read?'font-medium':'font-semibold'}`}>{item.title}</span><span className="mt-0.5 block truncate text-[12px] text-gray-500">{item.message}</span></span>
    <span className="shrink-0 whitespace-nowrap text-[11.5px] text-gray-500">{when(item.created_at)}</span>
    <span aria-label={item.read?undefined:'Unread'} className={`h-2 w-2 shrink-0 rounded-full ${item.read?'bg-transparent':'bg-blue-600'}`}/>
   </button>
  </li>})}</ul>}
 </div>;
}
