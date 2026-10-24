import {useEffect,useState} from 'react';
import {read,write} from '../../utils/storage';

// Settings page values. Company-wide ones live under 'settings:' keys (synchronized, Admin only on the server);
// appearance and the session timeout belong to each user on each device.
export interface CompanyProfile{name:string;address:string;contactNumber:string;email:string;tin:string;sssNo:string;philhealthNo:string;pagibigNo:string;logo:string}
export type DateFormat='MMM D, YYYY'|'MM/DD/YYYY'|'DD/MM/YYYY'|'YYYY-MM-DD';
export interface Regional{dateFormat:DateFormat;currency:'PHP';timeZone:'Asia/Manila';language:'English'}
export interface Branding{logo:string;headerText:string;footerText:string;logoOnPayslips:boolean;logoOnReports:boolean}
export interface PrivacySettings{hideSalaryFromHr:boolean;maskGovIds:boolean}
export interface BackupInfo{lastBackupAt:string;lastBackupBy:string}
export type UiColor='blue'|'green'|'teal'|'purple'|'graphite'|'orange'|'red'|'rose';
export type FontSize='small'|'medium'|'large';
export interface Appearance{color:UiColor;fontSize:FontSize}

export const DEFAULT_LOGO='/logo.png';
export const COMPANY_KEY='settings:company',REGIONAL_KEY='settings:regional',BRANDING_KEY='settings:branding',PRIVACY_KEY='settings:privacy',BACKUP_KEY='settings:backup';
const APPEARANCE_KEY='pbms:appearance',TIMEOUT_KEY='pbms:session-timeout';
export const SETTINGS_EVENT='pbms:settings';

export const DEFAULT_COMPANY:CompanyProfile={name:'Archon Nell Incorporated',address:'',contactNumber:'',email:'',tin:'',sssNo:'',philhealthNo:'',pagibigNo:'',logo:''};
export const DEFAULT_REGIONAL:Regional={dateFormat:'MMM D, YYYY',currency:'PHP',timeZone:'Asia/Manila',language:'English'};
export const DEFAULT_BRANDING:Branding={logo:'',headerText:'Archon Nell Incorporated',footerText:'',logoOnPayslips:true,logoOnReports:true};
export const DEFAULT_PRIVACY:PrivacySettings={hideSalaryFromHr:false,maskGovIds:false};
export const DEFAULT_APPEARANCE:Appearance={color:'blue',fontSize:'medium'};

export const loadCompany=():CompanyProfile=>({...DEFAULT_COMPANY,...read<Partial<CompanyProfile>>(COMPANY_KEY,{})});
export const loadRegional=():Regional=>({...DEFAULT_REGIONAL,...read<Partial<Regional>>(REGIONAL_KEY,{})});
export const loadBranding=():Branding=>({...DEFAULT_BRANDING,...read<Partial<Branding>>(BRANDING_KEY,{})});
export const loadPrivacy=():PrivacySettings=>({...DEFAULT_PRIVACY,...read<Partial<PrivacySettings>>(PRIVACY_KEY,{})});
export const loadBackup=():BackupInfo|null=>read<BackupInfo|null>(BACKUP_KEY,null);
const saved=<T,>(key:string,value:T)=>{write(key,value);window.dispatchEvent(new Event(SETTINGS_EVENT))};
export const saveCompany=(value:CompanyProfile)=>saved(COMPANY_KEY,value);
export const saveRegional=(value:Regional)=>saved(REGIONAL_KEY,value);
export const saveBranding=(value:Branding)=>saved(BRANDING_KEY,value);
export const savePrivacy=(value:PrivacySettings)=>saved(PRIVACY_KEY,value);
export const saveBackup=(value:BackupInfo)=>saved(BACKUP_KEY,value);

/** The company logo (sidebar, sign-in) and the document logo (payslips, reports); both default to the current logo. */
export const companyLogo=()=>loadCompany().logo||DEFAULT_LOGO;
export const documentLogo=()=>loadBranding().logo||loadCompany().logo||DEFAULT_LOGO;
/** Re-renders a component when any setting changes (on this page or after a server sync). */
export function useSettingsVersion(){
 const[version,setVersion]=useState(0);
 useEffect(()=>{const bump=()=>setVersion(v=>v+1);window.addEventListener(SETTINGS_EVENT,bump);window.addEventListener('storage',bump);return()=>{window.removeEventListener(SETTINGS_EVENT,bump);window.removeEventListener('storage',bump)}},[]);
 return version;
}

/** A government ID with all but its last 4 digits hidden, when masking is on. */
export function maskGovId(value:string|null|undefined){
 if(!value)return '—';
 if(!loadPrivacy().maskGovIds)return value;
 const digits=value.replace(/\D/g,'');
 return digits.length>4?`•••• ${digits.slice(-4)}`:'••••';
}

// Appearance: each theme pairs an accent with a matching sidebar ('blue' is the company default) and recolours every page; the font size scales the whole interface.
export const UI_COLORS:Array<{id:UiColor;label:string;swatch:string;sidebar:string}>=[
 {id:'blue',label:'Default',swatch:'#2563eb',sidebar:'#0b1f4b'},{id:'green',label:'Emerald',swatch:'#047857',sidebar:'#052e25'},{id:'teal',label:'Ocean',swatch:'#0f766e',sidebar:'#072f37'},{id:'purple',label:'Violet',swatch:'#7c3aed',sidebar:'#1e1446'},
 {id:'graphite',label:'Graphite',swatch:'#4f46e5',sidebar:'#111827'},{id:'orange',label:'Sunset',swatch:'#c2410c',sidebar:'#1c1917'},{id:'red',label:'Crimson',swatch:'#dc2626',sidebar:'#2a0b10'},{id:'rose',label:'Rose',swatch:'#e11d48',sidebar:'#2b1030'},
];
export const FONT_SIZES:Array<{id:FontSize;label:string}>=[{id:'small',label:'Small'},{id:'medium',label:'Medium'},{id:'large',label:'Large'}];
export function loadAppearance():Appearance{
 const value={...DEFAULT_APPEARANCE,...read<Partial<Appearance>>(APPEARANCE_KEY,{})};
 return UI_COLORS.some(color=>color.id===value.color)?value:{...value,color:DEFAULT_APPEARANCE.color};
}
export function applyAppearance(value=loadAppearance()){
 const root=document.documentElement;
 root.dataset.uiColor=value.color;root.dataset.fontSize=value.fontSize;
}
export const saveAppearance=(value:Appearance)=>{write(APPEARANCE_KEY,value);applyAppearance(value)};

/** Minutes of inactivity before the app signs out; 0 keeps the session until it expires. */
export const SESSION_TIMEOUTS=[5,15,30,60,0];
export const loadSessionTimeout=()=>{const value=read<number>(TIMEOUT_KEY,30);return SESSION_TIMEOUTS.includes(value)?value:30};
export const saveSessionTimeout=(minutes:number)=>{write(TIMEOUT_KEY,minutes);window.dispatchEvent(new Event(SETTINGS_EVENT))};

/** A YYYY-MM-DD date in the chosen format. */
export function formatWithSetting(year:number,month:number,day:number,format=loadRegional().dateFormat){
 const mm=String(month).padStart(2,'0'),dd=String(day).padStart(2,'0');
 if(format==='MM/DD/YYYY')return `${mm}/${dd}/${year}`;
 if(format==='DD/MM/YYYY')return `${dd}/${mm}/${year}`;
 if(format==='YYYY-MM-DD')return `${year}-${mm}-${dd}`;
 return new Date(Date.UTC(year,month-1,day)).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}
