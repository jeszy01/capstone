import {apiClient} from '../../services/api/apiClient';

export interface AccountSession{id:string;device:string;browser:string;createdAt:string;lastActiveAt:string;current:boolean}
/** One sign-in, kept after it ends: Active, Signed out or Expired. */
export interface SessionRecord{id:string;device:string;browser:string;createdAt:string;lastActiveAt:string;endedAt:string|null;status:'Active'|'Signed out'|'Expired';current:boolean}
export interface AccountSecurity{otpEnabled:boolean;otpAvailable:boolean;passkeySet:boolean;passkeyLockedUntil:string|null;sessions:AccountSession[];history:SessionRecord[]}
export type PasskeyPurpose='export'|'release'|'settings';
export type PasskeyResult={verified:true}|{verified:false;reason:'not_set'|'locked'|'invalid';attemptsLeft?:number;lockedUntil?:string|null};
type ServerSecurity={otp_enabled:boolean;otp_available:boolean;passkey_set?:boolean;passkey_locked_until?:string|null;sessions:Array<{id:string;device:string;browser:string;created_at:string;last_active_at:string;current:boolean}>;history?:Array<{id:string;device:string;browser:string;created_at:string;last_active_at:string;ended_at:string|null;status:SessionRecord['status'];current:boolean}>};

const fromServer=(data:ServerSecurity):AccountSecurity=>({otpEnabled:data.otp_enabled,otpAvailable:data.otp_available,passkeySet:Boolean(data.passkey_set),passkeyLockedUntil:data.passkey_locked_until??null,sessions:data.sessions.map(session=>({id:session.id,device:session.device,browser:session.browser,createdAt:session.created_at,lastActiveAt:session.last_active_at,current:session.current})),history:(data.history??[]).map(item=>({id:item.id,device:item.device,browser:item.browser,createdAt:item.created_at,lastActiveAt:item.last_active_at,endedAt:item.ended_at,status:item.status,current:item.current}))});
const verifyPasskey=(passkey:string,purpose:PasskeyPurpose,detail:string)=>apiClient.post<Record<string,unknown>,{data:{verified:boolean;reason?:'not_set'|'locked'|'invalid';attempts_left?:number;locked_until?:string|null}}>('/account',{action:'verify_passkey',passkey,purpose,detail}).then(({data}):PasskeyResult=>data.verified?{verified:true}:{verified:false,reason:data.reason??'invalid',attemptsLeft:data.attempts_left,lockedUntil:data.locked_until});
const post=(payload:Record<string,unknown>)=>apiClient.post<Record<string,unknown>,{data:ServerSecurity}>('/account',payload).then(response=>fromServer(response.data));

/** Password strength: 8-128 characters with upper case, lower case, a number and a symbol (also enforced by the server). */
export function passwordProblems(password:string):string[]{
 const problems:string[]=[];
 if(password.length<8||password.length>128)problems.push('Password must be 8 to 128 characters.');
 if(!/[A-Z]/.test(password)||!/[a-z]/.test(password))problems.push('Password must include upper-case and lower-case letters.');
 if(!/\d/.test(password))problems.push('Password must include a number.');
 if(!/[^A-Za-z0-9]/.test(password))problems.push('Password must include a symbol.');
 return problems;
}

/** Passkey: 6-64 characters (also enforced by the server, which also rejects the login password). */
export function passkeyProblems(passkey:string):string[]{return passkey.length<6||passkey.length>64?['Passkey must be 6 to 64 characters.']:[]}

// Every action applies to the signed-in user only; changes require the current password.
export const accountService={
 load:()=>apiClient.get<{data:ServerSecurity}>('/account').then(response=>fromServer(response.data)),
 changePassword:(currentPassword:string,newPassword:string)=>post({action:'change_password',current_password:currentPassword,new_password:newPassword}),
 setOtp:(currentPassword:string,enabled:boolean)=>post({action:'set_otp',current_password:currentPassword,enabled}),
 revokeSession:(currentPassword:string,sessionId:string)=>post({action:'revoke_session',current_password:currentPassword,session_id:sessionId}),
 setPasskey:(currentPassword:string,newPasskey:string)=>post({action:'set_passkey',current_password:currentPassword,new_passkey:newPasskey}),
 changePasskey:(currentPasskey:string,newPasskey:string)=>post({action:'change_passkey',current_passkey:currentPasskey,new_passkey:newPasskey}),
 resetPasskey:(currentPassword:string,newPasskey:string)=>post({action:'reset_passkey',current_password:currentPassword,new_passkey:newPasskey}),
 verifyPasskey,
 revokeOtherSessions:(currentPassword:string)=>post({action:'revoke_other_sessions',current_password:currentPassword}),
 setDisplayName:(displayName:string)=>apiClient.post<Record<string,unknown>,{data:{display_name:string}}>('/account',{action:'set_display_name',display_name:displayName}).then(response=>response.data.display_name),
 // keepalive lets the request finish while the page navigates to sign-in.
 signOut:()=>apiClient.post<Record<string,unknown>,unknown>('/account',{action:'sign_out'},{keepalive:true}),
};
