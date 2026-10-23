import {describe,expect,it} from 'vitest';
import {hmoTabs,hmoTabForPath} from '../features/hmo/hmoNavigation';
import {modules,titles} from '../components/navigation/navConfig';

describe('HMO presentation navigation',()=>{
  it('keeps the HMO tabs in order',()=>{
    expect(hmoTabs.map(tab=>tab.label)).toEqual([
      'HMO Plan','Employee Enrollment','Dependents','HMO Records',
    ]);
    expect(new Set(hmoTabs.map(tab=>tab.to)).size).toBe(4);
  });

  it('selects the corresponding panel on each direct route and refresh',()=>{
    for(const tab of hmoTabs){
      expect(hmoTabForPath(tab.to)).toBe(tab.id);
      expect(hmoTabForPath(`${tab.to}/`)).toBe(tab.id);
      expect(titles[tab.to]).toBe(tab.label);
    }
    expect(hmoTabForPath('/hmo-benefits')).toBe('plan');
    expect(titles['/hmo-benefits']).toBe('HMO & Benefits');
  });

  it('shows HMO & Benefits as a single link',()=>{
    const hmo=modules.find(item=>item.label==='HMO & Benefits');
    expect(hmo?.to).toBe('/hmo-benefits');
    expect(hmo?.children).toBeUndefined();
    // Government loans are deductions: they live under Payroll Management → Deductions, not in a sidebar module.
    expect(modules.flatMap(item=>item.children??[item]).some(item=>item.label==='Government Loans')).toBe(false);
  });

  it('shows Claims & Reimbursement as a single link with Claims and Reimbursement as page tabs',()=>{
    const claims=modules.find(item=>item.label==='Claims & Reimbursement');
    expect(claims?.to).toBe('/claims-reimbursement');
    expect(claims?.children).toBeUndefined();
    expect(titles['/claims-reimbursement/claims']).toBe('Claims & Reimbursement');
    expect(titles['/claims-reimbursement/reimbursement']).toBe('Claims & Reimbursement');
  });
});
