import type {Employee} from '../../types/domain'; import {localRepository} from '../../services/api/repository';
const repo=localRepository<Employee>('employees:records',[]); export const employeeRepository={list:repo.list,create:repo.create,update:repo.update,remove:repo.remove};
