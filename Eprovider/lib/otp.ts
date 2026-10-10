import {HttpError} from "./errors";
const apiUrl=()=> (Deno.env.get("EPROVIDER_OTP_API_URL")??"https://api.eprovider.site/api").replace(/\/$/,"");
export const MAX_OTP_ATTEMPTS=5;
export async function sendOtpEmail(email:string,otp:string,expiryMinutes=10){const key=Deno.env.get("EPROVIDER_OTP_KEY");if(!key)throw new HttpError(500,"CONFIGURATION_ERROR","EPROVIDER_OTP_KEY is not configured");const response=await fetch(`${apiUrl()}/send-otp`,{method:"POST",headers:{"content-type":"application/json","x-api-key":key},body:JSON.stringify({email,otp,expiryMinutes})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new HttpError(response.status===401?502:response.status===429?429:502,response.status===401?"OTP_PROVIDER_UNAUTHORIZED":response.status===429?"OTP_RATE_LIMITED":"OTP_PROVIDER_ERROR","Unable to send verification code");return data as {success?:boolean;message?:string;emailId?:string};}
export function generateOtp(){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return String(bytes[0]%1000000).padStart(6,"0");}
async function digest(value:string){const bytes=new TextEncoder().encode(value);const hash=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");}
export const hashOtp=(otp:string)=>digest(otp);
