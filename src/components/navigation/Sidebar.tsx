import {useEffect,useState} from 'react';
import {NavLink,useLocation} from 'react-router-dom';
import {ChevronDown,ChevronUp} from 'lucide-react';
import {overview,modules,system,type NavItem} from './navConfig';
import {getCurrentUser} from '../../features/auth/authService';
import {canOpen} from '../../features/auth/permissions';

// Only the open page's own item gets the blue pill; a group row and its sub-items look the same whatever is open.
const row='flex w-full items-center gap-[13px] rounded-[10px] px-[18px] h-10 text-[14px] font-medium text-[#d5ddf0] transition-colors';
const idle='hover:bg-white/[0.06]';
const active='bg-[#2563eb] text-white';
const label='px-[18px] pt-[22px] pb-[10px] text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8fa3d1]';

function Link({item,collapsed}:{item:NavItem;collapsed:boolean}){
  const Icon=item.icon;
  return <NavLink title={collapsed?item.label:undefined} to={item.to} className={({isActive})=>`${row} ${collapsed?'justify-center !px-2':''} ${isActive?active:idle}`}>
    {Icon&&<Icon size={18} strokeWidth={1.75} className="shrink-0"/>}<span className={collapsed?'sr-only':''}>{item.label}</span>
  </NavLink>;
}

function Group({item,collapsed}:{item:NavItem;collapsed:boolean}){
  const location=useLocation();
  const inside=item.children?.some(child=>location.pathname===child.to||location.pathname.startsWith(`${child.to}/`));
  const[open,setOpen]=useState(Boolean(inside));
  useEffect(()=>{if(inside)setOpen(true)},[inside]);
  const Icon=item.icon;
  return <>
    <button type="button" title={collapsed?item.label:undefined} className={`${row} ${idle} ${collapsed?'justify-center !px-2':''} text-left`} onClick={()=>setOpen(!open)} aria-expanded={open}>
      {Icon&&<Icon size={18} strokeWidth={1.75} className="shrink-0"/>}<span className={collapsed?'sr-only':''}>{item.label}</span>{!collapsed&&(open?<ChevronUp size={16} className="ml-auto"/>:<ChevronDown size={16} className="ml-auto"/>)}
    </button>
    {open&&!collapsed&&<div className="ml-[26px] border-l border-[#2a417a] pl-[14px]">
      {item.children?.map(child=><NavLink key={child.to} to={child.to} className={`flex h-[38px] items-center rounded-[10px] px-[11px] text-[13.5px] font-medium text-[#d5ddf0] transition-colors ${idle}`}>{child.label}</NavLink>)}
    </div>}
  </>;
}

// Menu items the signed-in role cannot open are hidden.
const visible=(items:NavItem[]):NavItem[]=>items.filter(item=>canOpen(item.to)).map(item=>item.children?{...item,children:item.children.filter(child=>canOpen(child.to))}:item);

export function Sidebar({onNavigate}:{onNavigate?:()=>void}){
  const[collapsed,setCollapsed]=useState(false);
  const user=getCurrentUser();
  const items=(list:NavItem[])=>visible(list).map(item=>item.children?<Group key={item.label} item={item} collapsed={collapsed}/>:<Link key={item.to} item={item} collapsed={collapsed}/>);
  return <aside className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto bg-[#0b1f4b] px-3 py-3 text-white transition-[width] duration-300 ease-in-out max-lg:h-dvh ${collapsed?'w-[84px]':'w-[260px]'}`}>
    <div className={`flex items-center gap-2.5 pb-4 pt-1 ${collapsed?'justify-center px-0':'px-1.5'}`}>
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white p-0.5"><img src="/logo.png" alt="" className="h-full w-full object-contain"/></div>
      {!collapsed&&<div><div className="text-[13px] font-bold">ARCHON NELL INC.</div><div className="text-[11px] font-medium uppercase tracking-[0.25em] text-[#8fa3d1]">PAYROLL &amp; BENEFITS</div></div>}
    </div>
    <nav onClick={event=>{if((event.target as HTMLElement).closest('a'))onNavigate?.()}} className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      {items(overview)}
      {!collapsed&&<div className={label}>MODULES</div>}
      {items(modules)}
      {!collapsed&&<div className={label}>SYSTEM</div>}
      {items(system)}
    </nav>
    <div className={`mt-4 flex items-center border-t border-[#2a417a] px-1 pt-4 ${collapsed?'justify-center':'gap-3'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#2563eb] text-xs font-bold text-white">{(user?.name||'U').charAt(0).toUpperCase()}</div>
      {!collapsed&&<div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-white">{user?.name}</div><div className="truncate text-[11px] text-[#8fa3d1]">{user?.role}</div></div>}
      <button type="button" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(value=>!value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg leading-none text-[#8fa3d1] transition-colors hover:bg-white/[0.06] hover:text-white">{collapsed?'»':'«'}</button>
    </div>
  </aside>;
}
