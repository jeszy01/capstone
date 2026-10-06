export interface ApiRequestOptions extends RequestInit{token?:string}
export interface ApiClient{get<T>(path:string,options?:ApiRequestOptions):Promise<T>;post<TBody,T>(path:string,body:TBody,options?:ApiRequestOptions):Promise<T>;put<TBody,T>(path:string,body:TBody,options?:ApiRequestOptions):Promise<T>;delete<T>(path:string,options?:ApiRequestOptions):Promise<T>}
