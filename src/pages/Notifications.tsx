import {useNavigate} from 'react-router-dom';
import {Card,Empty,PageHeader,ghost} from '../components/common/ui';
import {markAllRead,markRead,useNotifications} from '../features/notifications/notificationService';
import type {AppNotification} from '../features/notifications/notificationService';

const when=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?'—':date.toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})};

export default function Notifications(){
 const navigate=useNavigate();
 const items=useNotifications();
 const open=(item:AppNotification)=>{markRead(item.id);navigate(item.link)};
 return <div className="space-y-5">
  <PageHeader title="Notifications" actions={<button type="button" className={ghost} disabled={!items.some(item=>!item.read)} onClick={markAllRead}>Mark all as read</button>}/>
  <Card className="p-1.5">{!items.length?<Empty>No notifications</Empty>:<ul className="m-0 list-none divide-y divide-[#eef1f6] p-0">{items.map(item=><li key={item.id}>
   <button type="button" onClick={()=>open(item)} className={`flex w-full items-start gap-3 rounded-lg px-4 py-3.5 text-left transition hover:bg-gray-50 ${item.read?'':'bg-blue-50/50'}`}>
    <span aria-label={item.read?undefined:'Unread'} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read?'bg-transparent':'bg-blue-600'}`}/>
    <span className="min-w-0 flex-1"><span className={`block text-[13px] text-gray-800 ${item.read?'font-medium':'font-semibold'}`}>{item.title}</span><span className="mt-0.5 block truncate text-[12px] text-gray-500">{item.message}</span></span>
    <span className="shrink-0 whitespace-nowrap text-[11px] text-gray-400">{when(item.created_at)}</span>
   </button>
  </li>)}</ul>}</Card>
 </div>;
}
