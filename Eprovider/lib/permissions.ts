import permissions from "../../backend-render/permissions.json";
import type {PbmsRole} from "./types";

// The same role -> allowed actions map the Render backend and the frontend use.
export function can(role:PbmsRole|undefined,permission:string){
 return Boolean(role&&(permissions[role] as string[]|undefined)?.includes(permission));
}
