import {describe,expect,it} from 'vitest';
import {MASK,maskValue} from '../components/common/ui';

describe('confidential value masking',()=>{
 it('hides values until shown',()=>{
  expect(maskValue(false,'₱25,000.00')).toBe(MASK);
  expect(maskValue(true,'₱25,000.00')).toBe('₱25,000.00');
 });
 it('keeps empty markers visible',()=>{
  for(const empty of ['—','Unavailable','Not assigned',''])expect(maskValue(false,empty)).toBe(empty);
 });
});
