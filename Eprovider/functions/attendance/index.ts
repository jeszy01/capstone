import {verifiedEdge} from "../../lib/verified-function"; import {requirePbmsRole} from "../../lib/auth"; import {ok} from "../../lib/response"; import {listRows} from "../../lib/database"; import type {AttendanceRecord} from "../../lib/types";
export default verifiedEdge(async ctx=>{requirePbmsRole(ctx,["admin","hr_staff"]);return ok(await listRows<AttendanceRecord>("attendance_records"))});
