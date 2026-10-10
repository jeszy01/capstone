import {describe,expect,it} from 'vitest';
import {hmoTabs,hmoTabForPath} from '../features/hmo/hmoNavigation';
import {modules,titles} from '../components/navigation/navConfig';

describe('HMO presentation navigation',()=>{
  it('keeps the four remaining HMO tabs in order',()=>{
    expect(hmoTabs.map(tab=>tab.label)).toEqual([
      'HMO Plan','Employee Enrollment','Dependents','HMO History',
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

  it('groups benefit modules while retaining HMO details as internal tabs',()=>{
    const hmo=modules.find(item=>item.label==='HMO & Benefits');
    expect(hmo?.to).toBe('/hmo-benefits');
    expect(hmo?.children).toEqual([{label:'HMO',to:'/hmo-benefits/hmo'},{label:'Government Benefits',to:'/hmo-benefits/government-benefits'},{label:'Benefits History',to:'/hmo-benefits/benefits-history'}]);
  });

  it('leaves the Claims & Reimbursement navigation unchanged',()=>{
    const claims=modules.find(item=>item.label==='Claims & Reimbursement');
    expect(claims?.to).toBe('/reimbursement');
    expect(claims?.children).toEqual([
      {label:'Reimbursement',to:'/reimbursement'},
      {label:'Claims',to:'/claims'},
    ]);
  });
});
