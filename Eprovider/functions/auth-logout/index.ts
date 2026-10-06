import {edge} from "../../lib/function"; import {body,required} from "../../lib/validation"; import {ok} from "../../lib/response"; import {mcp} from "../../lib/eprovider";
export default edge(async ctx=>{const input=await body<{refresh_token:string}>(ctx.request);required(input.refresh_token,"refresh_token");return ok({logged_out:true})});
