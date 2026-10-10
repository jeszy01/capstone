import {context} from "./auth"; import {publicError} from "./errors"; import type {RequestContext} from "./types";
export function edge(handler:(ctx:RequestContext)=>Promise<Response>){return async(request:Request)=>{try{return await handler(context(request))}catch(error){return publicError(error)}}}
