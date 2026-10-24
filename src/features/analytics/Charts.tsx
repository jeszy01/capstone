import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {compactPeso} from './hrAnalytics';

// Small SVG charts for HR Analytics. Colours are the --chart-* tokens in index.css (validated for light and dark).
export const SERIES=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)'];
const AXIS={fill:'var(--chart-axis)',fontSize:11};

function useWidth(){
 const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(0);
 useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width));observer.observe(ref.current);return()=>observer.disconnect()},[]);
 return {ref,width};
}
/** Round axis ticks from min to a little above max. */
function ticks(min:number,max:number,count=6){
 const raw=(max-min)/(count-1)||1,power=10**Math.floor(Math.log10(raw)),step=[1,2,2.5,5,10].map(n=>n*power).find(n=>n>=raw)!;
 const start=Math.floor(min/step)*step,list:number[]=[];
 for(let value=start;value<=max+step*0.001||list.length<2;value+=step)list.push(value);
 if(list[list.length-1]<max)list.push(list[list.length-1]+step);
 return list;
}
/** A smooth path through the points (cardinal spline). */
function smooth(points:Array<[number,number]>){
 if(points.length<2)return points.length?`M${points[0][0]},${points[0][1]}`:'';
 let d=`M${points[0][0]},${points[0][1]}`;
 for(let i=0;i<points.length-1;i++){
  const p0=points[i-1]??points[i],p1=points[i],p2=points[i+1],p3=points[i+2]??p2,t=0.18;
  d+=` C${p1[0]+(p2[0]-p0[0])*t},${p1[1]+(p2[1]-p0[1])*t} ${p2[0]-(p3[0]-p1[0])*t},${p2[1]-(p3[1]-p1[1])*t} ${p2[0]},${p2[1]}`;
 }
 return d;
}
/** A bar with 4px rounded top corners standing on the baseline. */
const bar=(x:number,y:number,w:number,h:number)=>{const r=Math.min(4,w/2,h);return `M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`};

function Tooltip({x,y,width,children}:{x:number;y:number;width:number;children:ReactNode}){
 const left=Math.min(Math.max(x+12,0),Math.max(width-170,0));
 return <div role="tooltip" className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-lg" style={{left,top:Math.max(y-10,0)}}>{children}</div>;
}
const Row=({color,label,value,dashed=false}:{color:string;label:string;value:number;dashed?:boolean})=><div className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-gray-600"><i className={`inline-block h-2.5 w-2.5 rounded-full ${dashed?'border-2 border-dashed bg-transparent':''}`} style={dashed?{borderColor:color}:{background:color}}/>{label}</span><b className="tabular-nums text-gray-900">{compactPeso(value)}</b></div>;
export function Legend({items}:{items:Array<{label:string;color:string;dashed?:boolean}>}){
 return <div className="mt-2 flex flex-wrap justify-center gap-4 text-[12px] text-gray-600">{items.map(item=><span key={item.label} className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-full border-2 bg-white" style={{borderColor:item.color,borderStyle:item.dashed?'dashed':'solid'}}/>{item.label}</span>)}</div>;
}
export const NoData=()=><div className="grid h-[220px] place-items-center text-[13px] text-gray-500">No data yet.</div>;

const M={top:10,right:16,bottom:30,left:64};

/** Line chart: one value per series per period, with a crosshair tooltip. Series marked dashed have no markers. */
export function LineChart({labels,series,height=260}:{labels:string[];series:Array<{label:string;color:string;values:number[];dashed?:boolean;area?:boolean}>;height?:number}){
 const {ref,width}=useWidth(),[hover,setHover]=useState<number|null>(null);
 const all=series.flatMap(item=>item.values),axis=ticks(Math.min(...all)*0.95,Math.max(...all));
 const w=Math.max(width-M.left-M.right,1),h=height-M.top-M.bottom,lo=axis[0],hi=axis[axis.length-1];
 const x=(i:number)=>M.left+(labels.length===1?w/2:i*w/(labels.length-1)),y=(v:number)=>M.top+h-(v-lo)/(hi-lo||1)*h;
 const move=(event:React.MouseEvent<SVGRectElement>)=>{const box=event.currentTarget.getBoundingClientRect(),px=event.clientX-box.left;setHover(Math.max(0,Math.min(labels.length-1,Math.round((px/box.width)*(labels.length-1)))))};
 return <div ref={ref} className="relative">
  {width>0&&<svg width={width} height={height} role="img" aria-label={series.map(item=>item.label).join(', ')}>
   {axis.map(value=><g key={value}><line x1={M.left} x2={M.left+w} y1={y(value)} y2={y(value)} stroke="var(--chart-grid)"/><text x={M.left-10} y={y(value)} dy="0.32em" textAnchor="end" style={AXIS}>{compactPeso(value)}</text></g>)}
   {labels.map((label,i)=><text key={label+i} x={x(i)} y={height-8} textAnchor="middle" style={AXIS}>{label}</text>)}
   {series.filter(item=>item.area).map(item=><path key={`${item.label}-area`} d={`${smooth(item.values.map((v,i)=>[x(i),y(v)]))} L${x(item.values.length-1)},${M.top+h} L${x(0)},${M.top+h} Z`} fill={item.color} opacity={0.1}/>)}
   {series.map(item=><path key={item.label} d={smooth(item.values.map((v,i)=>[x(i),y(v)]))} fill="none" stroke={item.color} strokeWidth={2} strokeDasharray={item.dashed?'6 5':undefined}/>)}
   {hover!==null&&<line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top+h} stroke="var(--chart-axis)" strokeDasharray="3 3"/>}
   {series.filter(item=>!item.dashed).map(item=>item.values.map((v,i)=><circle key={`${item.label}${i}`} cx={x(i)} cy={y(v)} r={hover===i?5:4} fill="var(--chart-surface)" stroke={item.color} strokeWidth={2}/>))}
   <rect x={M.left} y={M.top} width={w} height={h} fill="transparent" onMouseMove={move} onMouseLeave={()=>setHover(null)}/>
  </svg>}
  {hover!==null&&<Tooltip x={x(hover)} y={M.top} width={width}><div className="mb-1 font-semibold text-gray-900">{labels[hover]}</div>{series.map(item=><Row key={item.label} color={item.color} label={item.label} value={item.values[hover]} dashed={item.dashed}/>)}</Tooltip>}
  <Legend items={series}/>
 </div>;
}

/** Bar chart: one bar per category, or groups of bars when each category has several values. */
export function BarChart({labels,series,height=240,barColors}:{labels:string[];series:Array<{label:string;color:string;values:number[]}>;height?:number;barColors?:string[]}){
 const {ref,width}=useWidth(),[hover,setHover]=useState<number|null>(null);
 const axis=ticks(0,Math.max(...series.flatMap(item=>item.values),1));
 const w=Math.max(width-M.left-M.right,1),h=height-M.top-M.bottom,hi=axis[axis.length-1];
 const band=w/Math.max(labels.length,1),barW=Math.min(barColors?44:56,band*(series.length>1?0.28:0.5)),gap=series.length>1?band*0.1:0;
 const y=(v:number)=>M.top+h-v/hi*h;
 const groupLeft=(i:number)=>M.left+i*band+band/2-(series.length*barW+(series.length-1)*gap)/2;
 return <div ref={ref} className="relative">
  {width>0&&<svg width={width} height={height} role="img" aria-label={labels.join(', ')}>
   {axis.map(value=><g key={value}><line x1={M.left} x2={M.left+w} y1={y(value)} y2={y(value)} stroke="var(--chart-grid)"/><text x={M.left-10} y={y(value)} dy="0.32em" textAnchor="end" style={AXIS}>{compactPeso(value)}</text></g>)}
   <line x1={M.left} x2={M.left+w} y1={M.top+h} y2={M.top+h} stroke="var(--chart-axis)" opacity={0.5}/>
   {labels.map((label,i)=><g key={label}>
    <text x={M.left+i*band+band/2} y={height-8} textAnchor="middle" style={AXIS}>{label}</text>
    {series.map((item,s)=>{const v=item.values[i]||0,bx=groupLeft(i)+s*(barW+gap);return v>0?<path key={item.label} d={bar(bx,y(v),barW,M.top+h-y(v))} fill={barColors?.[i]??item.color} opacity={hover===null||hover===i?1:0.55}/>:null})}
    <rect x={M.left+i*band} y={M.top} width={band} height={h} fill="transparent" onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}/>
   </g>)}
  </svg>}
  {hover!==null&&<Tooltip x={M.left+hover*band+band/2} y={M.top+10} width={width}><div className="mb-1 font-semibold text-gray-900">{labels[hover]}</div>{series.map(item=><Row key={item.label} color={barColors?.[hover]??item.color} label={item.label} value={item.values[hover]||0}/>)}</Tooltip>}
  {series.length>1&&<Legend items={series}/>}
 </div>;
}
