import permissions from '../../../backend-render/permissions.json';
import {getCurrentUser} from './authService';
import type {User} from '../../types/domain';

// The same role -> allowed actions map the server enforces; route guards, the sidebar and buttons all read it here.
export type Role=keyof typeof permissions;
export type Permission=(typeof permissions)[Role][number];
const roleKeys:Record<User['role'],Role>={'Admin':'admin','HR Staff':'hr_staff','Finance':'finance'};

export function can(permission:Permission,role:User['role']|undefined=getCurrentUser()?.role){
 const key=role?roleKeys[role]:undefined;
 return Boolean(key&&(permissions[key] as Permission[]).includes(permission));
}

// The permission each page needs, matched by path prefix (most specific first).
const routePermissions:Array<[string,Permission]>=[
 ['/logs-audits','audit.view'],
 ['/finance','payroll.fund'],
 ['/payroll-settings','settings.view'],
 ['/payroll','payroll.view'],
 ['/time-attendance','attendance.view'],
 ['/deductions','deductions.view'],
 ['/hr-analytics','employees.view'],
 ['/reports','payroll.view'],
 ['/employees','employees.view'],
 ['/compensation','compensation.view'],
 ['/claims-reimbursement','claims.view'],
 ['/hmo-benefits','hmo.view'],
 ['/dashboard','dashboard.view'],
];
export function canOpen(path:string){
 const match=routePermissions.find(([prefix])=>path===prefix||path.startsWith(`${prefix}/`));
 return !match||can(match[1]);
}
