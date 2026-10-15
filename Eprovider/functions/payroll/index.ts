import {verifiedEdge} from "../../lib/verified-function"; import {requirePbmsRole} from "../../lib/auth"; import {body} from "../../lib/validation"; import {ok} from "../../lib/response"; import {calculatePayroll} from "../../lib/payroll-engine"; import type {PayrollEngineRates} from "../../lib/payroll-engine"; import {listRows} from "../../lib/database"; import {HttpError} from "../../lib/errors"; import type {PayrollInput} from "../../lib/types";
const RATE_KEYS:Array<keyof PayrollEngineRates>=["hoursPerDay","daysPerMonth","otMultiplier","otRestMultiplier","sssRate","philRate","pagibigRate","payPeriodsPerMonth"];
// Payroll Settings are synchronized to app_data under "payroll:rates".
async function payrollRates():Promise<PayrollEngineRates>{
 const row=(await listRows<Record<string,unknown>>("app_data",{key:"payroll:rates"}))[0];
 const value=row&&!row.deleted&&typeof row.value==="object"?row.value as Record<string,unknown>:null;
 if(!value||RATE_KEYS.some(key=>!Number.isFinite(Number(value[key]))))throw new HttpError(409,"PAYROLL_SETTINGS_REQUIRED","Save Payroll Settings before calculating payroll.");
 return Object.fromEntries(RATE_KEYS.map(key=>[key,Number(value[key])])) as PayrollEngineRates;
}
export default verifiedEdge(async ctx=>{requirePbmsRole(ctx,["admin","hr_staff"]);if(ctx.request.method!=="POST")return new Response("Method Not Allowed",{status:405});const input=await body<PayrollInput>(ctx.request);return ok(calculatePayroll(input,await payrollRates()))});
