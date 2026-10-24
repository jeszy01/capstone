import {useEffect,useState} from 'react';
import {NavLink,useLocation} from 'react-router-dom';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {overview,modules,type NavItem} from './navConfig';
import {SlidersHorizontal} from 'lucide-react';
import {getCurrentUser} from '../../features/auth/authService';
import {can,canOpen} from '../../features/auth/permissions';

const base='flex w-full items-center gap-3 px-3.5 h-[44px] rounded-xl text-[13.5px] font-medium transition-all duration-200 group text-slate-400 hover:bg-white/[0.06] hover:text-white';
const active='bg-gradient-to-r from-blue-600 to-blue-500 !text-white shadow-lg shadow-blue-600/30';

function Link({item,collapsed}:{item:NavItem;collapsed:boolean}){
  const Icon=item.icon;
  return <NavLink title={collapsed?item.label:undefined} to={item.to} className={({isActive})=>`${base} ${collapsed?'justify-center px-2':''} ${isActive?active:''}`}>
    {Icon&&<Icon size={18}/>}<span className={collapsed?'sr-only':''}>{item.label}</span>
  </NavLink>;
}

function Group({item,collapsed}:{item:NavItem;collapsed:boolean}){
  const location=useLocation();
  const inside=location.pathname===item.to||location.pathname.startsWith(`${item.to}/`)||item.children?.some(child=>location.pathname===child.to||location.pathname.startsWith(`${child.to}/`));
  const[open,setOpen]=useState(Boolean(inside));
  useEffect(()=>{if(inside)setOpen(true)},[inside]);
  const Icon=item.icon;
  return <>
    <button title={collapsed?item.label:undefined} className={`${base} ${collapsed?'justify-center px-2':''} cursor-pointer text-left ${inside?'bg-white/5':''}`} onClick={()=>setOpen(!open)} aria-expanded={open}>
      {Icon&&<Icon size={18}/>}<span className={collapsed?'sr-only':''}>{item.label}</span>{!collapsed&&(open?<ChevronDown size={14} className="ml-auto opacity-70"/>:<ChevronRight size={14} className="ml-auto opacity-70"/>)}
    </button>
    {open&&<div className={`mb-2 border-l border-white/10 pb-1 pt-1 ${collapsed?'ml-2 pl-2':'ml-4 pl-3'}`}>
      {item.children?.map(child=><NavLink title={collapsed?child.label:undefined} key={child.to} to={child.to} end={child.to==='/employees'} className={({isActive})=>`flex items-center gap-3 rounded-lg px-2 py-2.5 text-[13px] hover:bg-white/[0.06] hover:text-white ${collapsed?'justify-center':''} ${isActive?'bg-white/[0.06] text-white':'text-slate-400'}`}>
        <i className={`h-[5px] w-[5px] shrink-0 rounded-full ${location.pathname===child.to||location.pathname.startsWith(`${child.to}/`)?'bg-blue-500':'bg-slate-500'}`}/><span className={collapsed?'sr-only':''}>{child.label}</span>
      </NavLink>)}
    </div>}
  </>;
}

// Menu items the signed-in role cannot open are hidden.
const visible=(items:NavItem[]):NavItem[]=>items.filter(item=>canOpen(item.to)).map(item=>item.children?{...item,children:item.children.filter(child=>canOpen(child.to))}:item);

export function Sidebar({onNavigate}:{onNavigate?:()=>void}){
  const[collapsed,setCollapsed]=useState(false);
  const user=getCurrentUser();
  return <aside className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto bg-[#0B1F3A] px-4 py-3 text-white transition-[width] duration-300 ease-in-out max-lg:h-dvh ${collapsed?'w-[84px]':'w-[260px]'}`}>
    <div className={`flex items-center gap-2.5 pb-4 pt-1 ${collapsed?'justify-center px-0':'px-1.5'}`}>
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white p-0.5"><img src="/logo.png" alt="" className="h-full w-full object-contain"/></div>
      {!collapsed&&<div><div className="text-[13px] font-bold">ARCHON NELL INC.</div><div className="text-blue-300 text-[11px] font-medium uppercase tracking-[0.25em]">PAYROLL &amp; BENEFITS</div></div>}
    </div>
    <nav onClick={event=>{if((event.target as HTMLElement).closest('a'))onNavigate?.()}} className="flex-1 overflow-y-auto">
      {!collapsed&&<div className="px-3.5 pt-5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.15em] text-slate-500">OVERVIEW</div>}
      {visible(overview).map(item=><Link key={item.to} item={item} collapsed={collapsed}/>)}
      {!collapsed&&<div className="px-3.5 pt-5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.15em] text-slate-500">MODULES</div>}
      {visible(modules).map(item=>item.children?<Group key={item.label} item={item} collapsed={collapsed}/>:<Link key={item.to} item={item} collapsed={collapsed}/>)}
      {can('settings.view')&&<>
  <div className="mx-2 my-3 border-t border-white/[0.06]"/>
  <Link item={{label:'Payroll Settings',to:'/payroll-settings',icon:SlidersHorizontal}} collapsed={collapsed}/>
</>}
    </nav>
    <div className={`mt-4 flex items-center border-t border-white/[0.06] px-1 pt-4 ${collapsed?'justify-center':'gap-3'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 text-xs font-bold text-white shadow-lg">{(user?.name||'U').charAt(0).toUpperCase()}</div>
      {!collapsed&&<div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-white truncate">{user?.name}</div><div className="text-[11px] text-slate-500 truncate">{user?.role}</div></div>}
      <button type="button" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(value=>!value)} className="grid h-8 w-8 shrink-0 place-items-center p-1.5 rounded-lg text-lg leading-none text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">{collapsed?'»':'«'}</button>
    </div>
  </aside>;
}
