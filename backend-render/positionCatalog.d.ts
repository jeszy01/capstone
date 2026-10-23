// Types for positionCatalog.js, which the frontend imports.
export type PayGrade={code:string;dailyRate:number;maxRate:number};
export type CatalogPosition={position:string;department:string;grade:string;marketRate:number};
export const PAY_GRADES:PayGrade[];
export const POSITIONS:CatalogPosition[];
export const DEPARTMENTS:string[];
export function positionGrade(position:unknown):(CatalogPosition&{dailyRate:number})|null;
