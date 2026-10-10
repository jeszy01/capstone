import {verifiedEdge} from "../../lib/verified-function"; import {requireAuth} from "../../lib/auth"; import {ok} from "../../lib/response"; import {mcp} from "../../lib/eprovider";
export default verifiedEdge(async ctx=>{requireAuth(ctx);const rows=await mcp("select_rows",{table:"users",filter:{id:ctx.userId??""},limit:1});return ok(rows)});
