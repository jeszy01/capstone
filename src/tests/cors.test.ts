import {describe,expect,it} from 'vitest';
import {corsPreflight} from '../../Eprovider/lib/function';

describe('Edge Function CORS preflight',()=>{
 it('allows the methods used by the browser API without allowing a role assertion header',async()=>{
  const request=new Request('https://functions.test/employees/employee-1',{
   method:'OPTIONS',
   headers:{
    origin:'https://payrollbenefits.eprovider.site',
    'access-control-request-method':'PUT',
    'access-control-request-headers':'authorization,content-type',
   },
  });

  const response=corsPreflight(request);
  const methods=response.headers.get('access-control-allow-methods')??'';
  const headers=response.headers.get('access-control-allow-headers')??'';

  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe('https://payrollbenefits.eprovider.site');
  for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS'])expect(methods).toContain(method);
  expect(headers.toLowerCase()).toContain('authorization');
  expect(headers.toLowerCase()).toContain('content-type');
  expect(headers.toLowerCase()).not.toContain('x-pbms-role');
 });

 it('does not reflect an unapproved origin',async()=>{
  const response=corsPreflight(new Request('https://functions.test/employees',{method:'OPTIONS',headers:{origin:'https://attacker.example'}}));
  expect(response.headers.get('access-control-allow-origin')).not.toBe('https://attacker.example');
 });
});
