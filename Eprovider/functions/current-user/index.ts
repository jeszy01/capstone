import {verifiedEdge} from "../../lib/verified-function"; import {requireAuth} from "../../lib/auth"; import {ok} from "../../lib/response"; import {mcp} from "../../lib/eprovider";
type UserRow={id:string;employee_id:string;name?:string|null;email?:string|null;role:string;status:string};
// Returns only public fields; password and passkey hashes never leave the server.
export default verifiedEdge(async ctx=>{requireAuth(ctx);const rows=await mcp<UserRow[]>("select_rows",{table:"users",filter:{id:ctx.userId??""},limit:1});return ok(rows.map(row=>({id:row.id,employee_id:row.employee_id,name:row.name??null,email:row.email??null,role:row.role,status:row.status})))});
