import {useOverlayFocus} from '../components/common/ui';
import {Outlet,useLocation,useNavigate} from 'react-router-dom';
import {useState,useEffect,useRef} from 'react';
import {Bell,ChevronDown,Search,Menu,ChevronRight,House} from 'lucide-react';
import {Sidebar} from '../components/navigation/Sidebar';
import {titles,modules} from '../components/navigation/navConfig';
import {logout} from '../features/auth/authService';
export default function AppLayout(){
 const {pathname}=useLocation(),navigate=useNavigate();
 const [mobileOpen,setMobileOpen]=useState(false);
 const drawer=useRef<HTMLDivElement>(null);useOverlayFocus(drawer,mobileOpen,()=>setMobileOpen(false));
 useEffect(()=>{const media=window.matchMedia('(min-width:1024px)');const close=()=>{if(media.matches)setMobileOpen(false)};media.addEventListener('change',close);return()=>media.removeEventListener('change',close)},[]);
 const title=titles[pathname]??'PBMS';
 const parent=modules.find(module=>module.children?.some(child=>pathname===child.to||pathname.startsWith(`${child.to}/`)));
 return <div className="pbms-shell flex min-h-screen bg-[#f4f6fa] text-slate-800">
  {mobileOpen&&<button aria-label="Close navigation" className="pbms-mobile-scrim fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={()=>setMobileOpen(false)}/>}
  <div ref={drawer} tabIndex={-1} role={mobileOpen?'dialog':undefined} aria-modal={mobileOpen?true:undefined} aria-label="Main navigation" className={`${mobileOpen?'fixed inset-y-0 left-0 z-40 block':'hidden'} lg:sticky lg:top-0 lg:block lg:h-screen lg:shrink-0`}><Sidebar onNavigate={()=>setMobileOpen(false)}/></div>
  <div className="flex min-w-0 flex-1 flex-col">
   <header className="pbms-topbar sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-4 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur sm:px-7">
    <div className="flex min-w-0 items-center gap-3"><button aria-label="Open navigation" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 lg:hidden" onClick={()=>setMobileOpen(!mobileOpen)}><Menu size={19}/></button><div className="min-w-0"><div className="truncate text-[14px] font-semibold text-slate-800">{title}</div><nav aria-label="Breadcrumb" className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400"><House size={12}/><span>Home</span><ChevronRight size={12}/>{parent&&parent.label!==title&&<><span className="hidden sm:inline">{parent.label}</span><ChevronRight size={12} className="hidden sm:inline"/></>}<span className="truncate text-slate-500">{title}</span></nav></div></div>
    <div className="flex shrink-0 items-center gap-3"><div className="hidden w-56 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-400 xl:flex"><Search size={16}/><input aria-label="Header search" placeholder="Search employees, claims..." className="w-full bg-transparent text-[12px] text-slate-600 outline-none"/></div><button aria-label="Notifications" className="relative grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><Bell size={18}/><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-blue-500"/></button><span className="hidden h-7 w-px bg-slate-200 sm:block"/><button title="Sign out" onClick={()=>{logout();navigate('/')}} className="flex items-center gap-2.5 rounded-xl bg-white py-1 text-[12.5px] font-semibold text-slate-700"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#17345b] text-xs font-semibold text-white">A</span><span className="hidden sm:block">Admin</span><ChevronDown size={14} className="text-slate-400"/></button></div>
   </header>
   <main className="pbms-content min-w-0 flex-1 px-4 py-6 sm:p-7 lg:p-8"><Outlet/></main>
  </div>
 </div>;
}
