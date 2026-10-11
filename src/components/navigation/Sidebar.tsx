import {useEffect,useState} from 'react';
import {NavLink,useLocation} from 'react-router-dom';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {overview,modules,type NavItem} from './navConfig';
import {SlidersHorizontal} from 'lucide-react';
import {getCurrentUser} from '../../features/auth/authService';

const base='flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium text-[#c5d0e3] transition-colors hover:bg-white/7 hover:text-white';
const active='bg-[#203f69] text-white shadow-[inset_3px_0_0_#60a5fa]';

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
      {item.children?.map(child=><NavLink title={collapsed?child.label:undefined} key={child.to} to={child.to} end={child.to==='/employees'} className={({isActive})=>`flex items-center gap-3 rounded-lg px-2 py-2.5 text-[13px] hover:bg-white/5 hover:text-white ${collapsed?'justify-center':''} ${isActive?'bg-[#203f69] text-white':'text-[#aab4d0]'}`}>
        <i className={`h-[5px] w-[5px] shrink-0 rounded-full ${location.pathname===child.to?'bg-[#4aa3d6]':'bg-[#7d8bb0]'}`}/><span className={collapsed?'sr-only':''}>{child.label}</span>
      </NavLink>)}
    </div>}
  </>;
}

export function Sidebar({onNavigate}:{onNavigate?:()=>void}){
  const[collapsed,setCollapsed]=useState(false);
  return <aside className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto bg-[#10243f] px-4 py-5 text-white transition-[width] duration-200 ${collapsed?'w-[84px]':'w-[248px]'}`}>
    <div className={`flex items-center gap-2.5 pb-4 pt-1 ${collapsed?'justify-center px-0':'px-1.5'}`}>
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white p-0.5"><img src="/logo.png" alt="" className="h-full w-full object-contain"/></div>
      {!collapsed&&<div><div className="text-[13px] font-bold">ARCHON NELL INC.</div><div className="text-[10px] tracking-wide text-[#aab4d0]">PAYROLL &amp; BENEFITS</div></div>}
    </div>
    <nav onClick={event=>{if((event.target as HTMLElement).closest('a'))onNavigate?.()}} className="flex-1 overflow-y-auto">
      {!collapsed&&<div className="mx-2 mb-1.5 mt-3.5 text-[10px] font-semibold tracking-[0.16em] text-[#8e9bbd]">OVERVIEW</div>}
      {overview.map(item=><Link key={item.to} item={item} collapsed={collapsed}/>)}
      {!collapsed&&<div className="mx-2 mb-1.5 mt-3.5 text-[10px] font-semibold tracking-[0.16em] text-[#8e9bbd]">MODULES</div>}
      {modules.map(item=>item.children?<Group key={item.label} item={item} collapsed={collapsed}/>:<Link key={item.to} item={item} collapsed={collapsed}/>)}
      {getCurrentUser()?.role==='Admin'&&<>
  <div className="mx-2 my-3 border-t border-white/20"/>
  <Link item={{label:'Payroll Settings',to:'/payroll-settings',icon:SlidersHorizontal}} collapsed={collapsed}/>
</>}
    </nav>
    <div className={`mt-4 flex items-center rounded-xl border border-white/10 bg-[#10243f] p-1.5 ${collapsed?'justify-center':'gap-2'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 text-xs font-bold text-white shadow-lg">A</div>
      {!collapsed&&<div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold text-white">Admin</div><div className="truncate text-[10px] text-blue-100/80">Admin</div></div>}
      <button type="button" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(value=>!value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/15 bg-[#10243f] text-lg leading-none text-blue-50 transition hover:bg-[#17345b]">{collapsed?'»':'«'}</button>
    </div>
  </aside>;
}
