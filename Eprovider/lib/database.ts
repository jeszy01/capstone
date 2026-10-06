import {mcp} from "./eprovider";
export const listRows=<T>(table:string,filter:Record<string,unknown>={})=>mcp<T[]>("select_rows",{table,filter,limit:1000});
export const insertRow=<T>(table:string,values:Record<string,unknown>)=>mcp<T>("insert_row",{table,values});
export const updateRows=(table:string,pk:Record<string,unknown>,values:Record<string,unknown>)=>mcp<{count:number}>("update_rows",{table,pk,values});
export const deleteRows=(table:string,pk:Record<string,unknown>)=>mcp<{count:number}>("delete_rows",{table,pk});
