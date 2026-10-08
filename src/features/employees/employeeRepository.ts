import type {Employee} from '../../types/domain';
export const employeeRepository={list:async():Promise<Employee[]>=>[],create:async(e:Employee)=>e,update:async(e:Employee)=>e,remove:async(_id:string)=>{}};
