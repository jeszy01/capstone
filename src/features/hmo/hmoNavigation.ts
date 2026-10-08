export const hmoTabs = [
  { id: 'plan', label: 'HMO Plan', to: '/hmo-benefits/plan' },
  { id: 'enrollment', label: 'Employee Enrollment', to: '/hmo-benefits/employee-enrollment' },
  { id: 'dependents', label: 'Dependents', to: '/hmo-benefits/dependents' },
  { id: 'utilization', label: 'HMO Utilization', to: '/hmo-benefits/utilization' },
  { id: 'history', label: 'HMO History', to: '/hmo-benefits/history' },
] as const;

export type HmoTab = typeof hmoTabs[number]['id'];

export function hmoTabForPath(pathname: string): HmoTab {
  const path = pathname.replace(/\/$/, '');
  return hmoTabs.find(tab => tab.to === path)?.id ?? 'plan';
}
