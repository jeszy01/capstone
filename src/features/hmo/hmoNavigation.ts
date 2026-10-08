export const hmoTabs = [
  { id: 'plan', label: 'HMO Plan', to: '/hmo-benefits/hmo/plan' },
  { id: 'enrollment', label: 'Employee Enrollment', to: '/hmo-benefits/hmo/employee-enrollment' },
  { id: 'dependents', label: 'Dependents', to: '/hmo-benefits/hmo/dependents' },
  { id: 'utilization', label: 'HMO Utilization', to: '/hmo-benefits/hmo/utilization' },
  { id: 'history', label: 'HMO History', to: '/hmo-benefits/hmo/history' },
] as const;
export type HmoTab = typeof hmoTabs[number]['id'];
export function hmoTabForPath(pathname: string): HmoTab {
  const path = pathname.replace(/\/$/, '');
  return hmoTabs.find(tab => tab.to === path)?.id
    ?? ({'/hmo-benefits/plan':'plan','/hmo-benefits/employee-enrollment':'enrollment','/hmo-benefits/dependents':'dependents','/hmo-benefits/utilization':'utilization','/hmo-benefits/history':'history'} as Record<string,HmoTab>)[path]
    ?? 'plan';
}
