// Maxicare is not connected to PBMS: a request HR marked as sent to Maxicare with no answer after 3 working days is
// flagged for HR to follow up.
import {describe,expect,it} from 'vitest';
import {MAXICARE_FOLLOW_UP_WORKING_DAYS,maxicareFollowUpDue,workingDaysBetween} from '../../backend-render/hmoRules.js';

describe('working days waited for Maxicare',()=>{
 it('counts Monday to Friday after the day the request was sent',()=>{
  // Sent Friday, October 23, 2026: Monday 26, Tuesday 27 and Wednesday 28 are the 3 working days.
  expect(workingDaysBetween('2026-10-23','2026-10-26')).toBe(1);
  expect(workingDaysBetween('2026-10-23','2026-10-28')).toBe(3);
  expect(workingDaysBetween('2026-10-23','2026-10-23')).toBe(0);
 });
 it('skips holidays in the holiday calendar',()=>{
  expect(workingDaysBetween('2026-10-23','2026-10-28',['2026-10-26'])).toBe(2);
 });
});

describe('when HR has to follow up with Maxicare',()=>{
 // 10:00 AM in Manila on Friday, October 23 (02:00 UTC).
 const sent='2026-10-23T02:00:00.000Z';
 it(`after ${MAXICARE_FOLLOW_UP_WORKING_DAYS} working days without an answer`,()=>{
  expect(maxicareFollowUpDue('Pending',sent,'2026-10-27')).toBe(false);
  expect(maxicareFollowUpDue('Pending',sent,'2026-10-28')).toBe(true);
  expect(maxicareFollowUpDue('Pending',sent,'2026-10-28',['2026-10-26'])).toBe(false);
 });
 it('counts from the Manila date it was sent',()=>{
  // 11:30 PM on October 22 UTC is already October 23 in Manila.
  expect(workingDaysBetween('2026-10-23','2026-10-28')).toBe(3);
  expect(maxicareFollowUpDue('Pending','2026-10-22T23:30:00.000Z','2026-10-28')).toBe(true);
 });
 it('not once Maxicare has answered, or before the request was sent',()=>{
  for(const status of ['Active','Rejected','Not Submitted'])expect(maxicareFollowUpDue(status,sent,'2026-11-30')).toBe(false);
  expect(maxicareFollowUpDue('Pending',null,'2026-11-30')).toBe(false);
 });
});
