import {useEffect,useState} from 'react';
import {NavLink,useLocation} from 'react-router-dom';
import {ChevronDown,ChevronUp} from 'lucide-react';
import {overview,modules,insights,system,type NavItem} from './navConfig';
import {getCurrentUser} from '../../features/auth/authService';
import {canOpen} from '../../features/auth/permissions';
import {companyLogo,useSettingsVersion} from '../../features/settings/systemSettings';

// Only the open page's own item gets the blue pill; a group row and its sub-items look the same whatever is open.
const row='flex w-full items-center gap-3 rounded-[10px] px-[18px] h-10 whitespace-nowrap text-[13px] font-medium text-[var(--sidebar-text)] transition-colors';
const idle='hover:bg-white/[0.06]';
const active='bg-blue-600 text-white';
const label='px-[18px] pt-[26px] pb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)]';

function Link({item,collapsed}:{item:NavItem;collapsed:boolean}){
  const Icon=item.icon;
  return <NavLink title={collapsed?item.label:undefined} to={item.to} className={({isActive})=>`${row} ${collapsed?'justify-center !px-2':''} ${isActive?active:idle}`}>
    {Icon&&<Icon size={17} strokeWidth={1.75} className="shrink-0"/>}<span className={collapsed?'sr-only':''}>{item.label}</span>
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
      {Icon&&<Icon size={17} strokeWidth={1.75} className="shrink-0"/>}<span className={collapsed?'sr-only':''}>{item.label}</span>{!collapsed&&(open?<ChevronUp size={16} className="ml-auto"/>:<ChevronDown size={16} className="ml-auto"/>)}
    </button>
    {open&&!collapsed&&<div className="my-1 ml-[26px] flex flex-col gap-1 border-l border-[var(--sidebar-line)] pl-[14px]">
      {item.children?.map(child=><NavLink key={child.to} to={child.to} className={`flex h-9 items-center whitespace-nowrap rounded-[10px] px-[11px] text-[12.5px] font-medium text-[var(--sidebar-text)] transition-colors ${idle}`}>{child.label}</NavLink>)}
    </div>}
  </>;
}

// Menu items the signed-in role cannot open are hidden.
const visible=(items:NavItem[]):NavItem[]=>items.filter(item=>canOpen(item.to)).map(item=>item.children?{...item,children:item.children.filter(child=>canOpen(child.to))}:item);

export function Sidebar({onNavigate}:{onNavigate?:()=>void}){
  const[collapsed,setCollapsed]=useState(false);
  const user=getCurrentUser();
  useSettingsVersion();
  const items=(list:NavItem[])=>visible(list).map(item=>item.children?<Group key={item.label} item={item} collapsed={collapsed}/>:<Link key={item.to} item={item} collapsed={collapsed}/>);
  return <aside className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto bg-[var(--sidebar-bg)] px-3 py-3 text-white transition-[width] duration-300 ease-in-out max-lg:h-dvh ${collapsed?'w-[84px]':'w-[260px]'}`}>
    <div className={`flex items-center gap-2.5 pb-4 pt-1 ${collapsed?'justify-center px-0':'px-1.5'}`}>
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white p-0.5"><img src={companyLogo()} alt="" className="h-full w-full object-contain"/></div>
      {!collapsed&&<div><div className="text-[13px] font-bold">ARCHON NELL INC.</div><div className="text-[11px] font-medium uppercase tracking-[0.25em] text-[var(--sidebar-muted)]">PAYROLL &amp; BENEFITS</div></div>}
    </div>
    <nav onClick={event=>{if((event.target as HTMLElement).closest('a'))onNavigate?.()}} className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
      {items(overview)}
      {!collapsed&&<div className={label}>MODULES</div>}
      {items(modules)}
      {visible(insights).length>0&&!collapsed&&<div className={label}>INSIGHTS</div>}
      {items(insights)}
      {!collapsed&&<div className={label}>SYSTEM</div>}
      {items(system)}
    </nav>
    <div className={`mt-4 flex items-center border-t border-[var(--sidebar-line)] px-1 pt-4 ${collapsed?'justify-center':'gap-3'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-xs font-bold text-white">{(user?.name||'U').charAt(0).toUpperCase()}</div>
      {!collapsed&&<div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-white">{user?.name}</div><div className="truncate text-[11px] text-[var(--sidebar-muted)]">{user?.role}</div></div>}
      <button type="button" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(value=>!value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg leading-none text-[var(--sidebar-muted)] transition-colors hover:bg-white/[0.06] hover:text-white">{collapsed?'»':'«'}</button>
    </div>
  </aside>;
}
