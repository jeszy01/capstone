import {mcp} from "./eprovider";
import {SESSION_HOURS} from "./jwt";

export interface UserSession{id:string;user_id:string;device:string;browser:string;created_at:string;last_active_at:string;expires_at:string;revoked_at?:string|null}

/** Readable device and browser names from a user-agent string. */
export function describeUserAgent(userAgent:string){
 const ua=userAgent||"";
 const device=/iPhone/i.test(ua)?"iPhone":/iPad/i.test(ua)?"iPad":/Android/i.test(ua)?(/Mobile/i.test(ua)?"Android phone":"Android tablet"):/Windows/i.test(ua)?"Windows computer":/Macintosh|Mac OS X/i.test(ua)?"Mac":/CrOS/i.test(ua)?"Chromebook":/Linux/i.test(ua)?"Linux computer":"Unknown device";
 const browser=/Edg\//.test(ua)?"Edge":/OPR\/|Opera/.test(ua)?"Opera":/Firefox\//.test(ua)?"Firefox":/Chrome\//.test(ua)?"Chrome":/Safari\//.test(ua)?"Safari":"Unknown browser";
 return {device,browser};
}

/** Records a signed-in device. Returns undefined when sessions cannot be stored, so sign-in still succeeds. */
export async function startSession(userId:string,request:Request){
 try{
  const userAgent=request.headers.get("user-agent")??"";
  const now=Date.now();
  const row=await mcp<{id?:string}>("insert_row",{table:"user_sessions",values:{user_id:userId,...describeUserAgent(userAgent),user_agent:userAgent.slice(0,500),last_active_at:new Date(now).toISOString(),expires_at:new Date(now+SESSION_HOURS*3600_000).toISOString()}});
  return typeof row?.id==="string"?row.id:undefined;
 }catch{return undefined}
}

export const sessionActive=(session:UserSession|undefined,userId:string,now=Date.now()):session is UserSession=>Boolean(session&&session.user_id===userId&&!session.revoked_at&&Date.parse(session.expires_at)>now);
