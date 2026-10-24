import {useOverlayFocus} from '../components/common/ui';
import {Outlet,useLocation,useNavigate} from 'react-router-dom';
import {useState,useEffect,useRef} from 'react';
import {Bell,ChevronDown,Search,Menu,ChevronRight,House,ShieldCheck,ClipboardList,Landmark,LogOut,Sun,Moon} from 'lucide-react';
import {Sidebar} from '../components/navigation/Sidebar';
import {titles,modules} from '../components/navigation/navConfig';
import {CURRENT_USER_EVENT,getCurrentUser,logout,profileName} from '../features/auth/authService';
import {can} from '../features/auth/permissions';
import {accountService} from '../features/auth/accountService';
import {PasskeyGateHost} from '../features/auth/passkeyGate';
import {useNotifications} from '../features/notifications/notificationService';
import {watchNotificationSound} from '../features/notifications/notificationSound';
// Sign out ends this device's server session, then clears the local session.
const endSession=()=>{void accountService.signOut().catch(()=>undefined);logout()};

export default function AppLayout(){
 const {pathname}=useLocation(),navigate=useNavigate();
 const [mobileOpen,setMobileOpen]=useState(false),[adminOpen,setAdminOpen]=useState(false),[theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('pbms:theme')==='dark'?'dark':'light');
 const drawer=useRef<HTMLDivElement>(null),adminMenu=useRef<HTMLDivElement>(null);useOverlayFocus(drawer,mobileOpen,()=>setMobileOpen(false));
 useEffect(()=>{const media=window.matchMedia('(min-width:1024px)');const close=()=>{if(media.matches)setMobileOpen(false)};media.addEventListener('change',close);return()=>media.removeEventListener('change',close)},[]);
 useEffect(()=>{if(!adminOpen)return;const close=(event:MouseEvent)=>{if(adminMenu.current&&!adminMenu.current.contains(event.target as Node))setAdminOpen(false)};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setAdminOpen(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key)}},[adminOpen]);
 useEffect(()=>{document.documentElement.classList.toggle('pbms-dark',theme==='dark');localStorage.setItem('pbms:theme',theme)},[theme]);
 useEffect(()=>{
 const LIMIT=5*60*1000;
 let timer=0;
 const reset=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>{endSession();window.location.assign('/')},LIMIT)};
 const events=['mousemove','mousedown','keydown','scroll','touchstart'];
 events.forEach(e=>window.addEventListener(e,reset,{passive:true}));
 reset();
 return()=>{window.clearTimeout(timer);events.forEach(e=>window.removeEventListener(e,reset))};
},[navigate]);
 const title=titles[pathname]??'PBMS';
 // Re-read the signed-in user when their details change, e.g. a new display name.
 const[user,setUser]=useState(getCurrentUser);
 useEffect(()=>{const sync=()=>setUser(getCurrentUser());window.addEventListener(CURRENT_USER_EVENT,sync);return()=>window.removeEventListener(CURRENT_USER_EVENT,sync)},[]);
 const userName=profileName(user)||'User';
 const parent=modules.find(module=>module.children?.some(child=>pathname===child.to||pathname.startsWith(`${child.to}/`)));
 const go=(path:string)=>{setAdminOpen(false);navigate(path)};
 const signOut=()=>{setAdminOpen(false);endSession();window.location.assign('/')};
 // The bell, the Notifications page and the sound use only the signed-in role's notifications.
 const unreadCount=useNotifications().filter(item=>!item.read).length;
 useEffect(()=>watchNotificationSound(),[]);
 return <div className="pbms-shell flex min-h-screen bg-[#F8FAFC] text-gray-800 max-md:overflow-x-clip">
  {mobileOpen&&<button aria-label="Close navigation" className="pbms-mobile-scrim fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={()=>setMobileOpen(false)}/>}
  {/* Below lg the sidebar is a drawer that slides in from the left. */}
  <div ref={drawer} tabIndex={-1} role={mobileOpen?'dialog':undefined} aria-modal={mobileOpen?true:undefined} aria-label="Main navigation" className={`max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:transition-[transform,visibility] max-lg:duration-200 ${mobileOpen?'':'max-lg:invisible max-lg:-translate-x-full'} lg:sticky lg:top-0 lg:block lg:h-screen lg:shrink-0`}><Sidebar onNavigate={()=>setMobileOpen(false)}/></div>
  <div className="flex min-w-0 flex-1 flex-col">
   <header className="pbms-topbar sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-gray-100 bg-white px-3 sm:px-6 max-md:gap-2">
    <div className="flex min-w-0 items-center gap-3"><button aria-label="Open navigation" className="p-2.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 shrink-0 lg:hidden" onClick={()=>setMobileOpen(!mobileOpen)}><Menu size={19}/></button><div className="min-w-0"><div className="truncate text-[13px] font-semibold text-gray-900 leading-tight">{title}</div><nav aria-label="Breadcrumb" className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500"><House size={12}/><span>Home</span><ChevronRight size={12}/>{parent&&parent.label!==title&&<><span className="hidden sm:inline">{parent.label}</span><ChevronRight size={12} className="hidden sm:inline"/></>}<span className="truncate text-gray-500">{title}</span></nav></div></div>
    <div className="flex shrink-0 items-center gap-3 max-md:gap-2"><div className="hidden w-56 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-gray-400 transition-all duration-200 hover:border-gray-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/15 xl:flex"><Search size={16}/><input aria-label="Header search" placeholder="Search employees, claims..." className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"/></div><button type="button" aria-label={unreadCount?`Notifications, ${unreadCount} unread`:'Notifications'} className="relative p-2.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700" onClick={()=>{setAdminOpen(false);navigate('/notifications')}}><Bell size={18}/>{unreadCount>0&&<span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold ring-2 ring-white">{unreadCount>9?'9+':unreadCount}</span>}</button><button type="button" aria-label={`Switch to ${theme==='dark'?'light':'dark'} theme`} title={`Switch to ${theme==='dark'?'light':'dark'} theme`} onClick={()=>setTheme(current=>current==='dark'?'light':'dark')} className="relative p-2.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700">{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button><span className="w-px h-8 bg-gray-200 hidden md:block"/><div ref={adminMenu} className="relative"><button type="button" aria-label="Open profile menu" aria-haspopup="menu" aria-expanded={adminOpen} onClick={()=>setAdminOpen(open=>!open)} className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-gray-50 transition-colors text-[13px] font-semibold text-gray-900"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-xs font-semibold text-white">{userName.charAt(0).toUpperCase()}</span><span className="hidden sm:block">{userName}</span><ChevronDown size={14} className={`text-gray-400 transition-transform ${adminOpen?'rotate-180':''}`}/></button>{adminOpen&&<div role="menu" aria-label="Profile options" className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 animate-scaleIn z-50"><div className="px-4 py-3 border-b border-gray-100"><div className="truncate text-[13px] font-semibold text-gray-800">{userName}</div><div className="mt-1.5"><span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">{user?.role}</span></div></div><div className="mt-1.5"/><button type="button" role="menuitem" onClick={()=>go('/settings-privacy')} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] font-medium hover:bg-gray-50 ${pathname==='/settings-privacy'?'bg-blue-50 text-blue-700':'text-gray-700'}`}><ShieldCheck size={17} className="text-gray-400"/><span>Settings &amp; Privacy</span></button>{can('audit.view')&&<button type="button" role="menuitem" onClick={()=>go('/logs-audits')} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] font-medium hover:bg-gray-50 ${pathname==='/logs-audits'?'bg-blue-50 text-blue-700':'text-gray-700'}`}><ClipboardList size={17} className="text-gray-400"/><span>Logs &amp; Audits</span></button>}{can('payroll.fund')&&<button type="button" role="menuitem" onClick={()=>go('/finance')} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] font-medium hover:bg-gray-50 ${pathname==='/finance'?'bg-blue-50 text-blue-700':'text-gray-700'}`}><Landmark size={17} className="text-gray-400"/><span>Finance</span></button>}<div className="my-1 border-t border-gray-100"/><button type="button" role="menuitem" onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] font-medium text-red-600 hover:bg-red-50"><LogOut size={17}/><span>Sign out</span></button></div>}</div></div>
   </header>
   <main className="pbms-content min-w-0 flex-1 px-4 sm:px-6 lg:px-8 py-6"><div className="mx-auto w-full max-w-[1680px]"><Outlet/></div></main>
   <PasskeyGateHost/>
  </div>
 </div>;
}
