import {apiClient} from '../../services/api/apiClient';

export interface AccountSession{id:string;device:string;browser:string;createdAt:string;lastActiveAt:string;current:boolean}
export interface AccountSecurity{otpEnabled:boolean;otpAvailable:boolean;sessions:AccountSession[]}
type ServerSecurity={otp_enabled:boolean;otp_available:boolean;sessions:Array<{id:string;device:string;browser:string;created_at:string;last_active_at:string;current:boolean}>};

const fromServer=(data:ServerSecurity):AccountSecurity=>({otpEnabled:data.otp_enabled,otpAvailable:data.otp_available,sessions:data.sessions.map(session=>({id:session.id,device:session.device,browser:session.browser,createdAt:session.created_at,lastActiveAt:session.last_active_at,current:session.current}))});
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

// Every action applies to the signed-in user only; changes require the current password.
export const accountService={
 load:()=>apiClient.get<{data:ServerSecurity}>('/account').then(response=>fromServer(response.data)),
 changePassword:(currentPassword:string,newPassword:string)=>post({action:'change_password',current_password:currentPassword,new_password:newPassword}),
 setOtp:(currentPassword:string,enabled:boolean)=>post({action:'set_otp',current_password:currentPassword,enabled}),
 revokeSession:(currentPassword:string,sessionId:string)=>post({action:'revoke_session',current_password:currentPassword,session_id:sessionId}),
 revokeOtherSessions:(currentPassword:string)=>post({action:'revoke_other_sessions',current_password:currentPassword}),
 // keepalive lets the request finish while the page navigates to sign-in.
 signOut:()=>apiClient.post<Record<string,unknown>,unknown>('/account',{action:'sign_out'},{keepalive:true}),
};
