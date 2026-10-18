// Types for the parts of accessRules.js the frontend tests import.
export function appDataEvents(user:{id:string;role:string},key:string,before:unknown,after:unknown,existed:boolean,releasedRecentlyBy?:(user:unknown,id:string)=>Promise<boolean>):Promise<Array<[string,string,string,string]>>;
