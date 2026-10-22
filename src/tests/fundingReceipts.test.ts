import {describe,expect,it} from 'vitest';
import {RECEIPT_MAX_BYTES,checkReceipt,receiptFileName,receiptType} from '../../backend-render/fundingReceipts.js';

const file=(head:number[],size=head.length)=>{const bytes=new Uint8Array(size);bytes.set(head);return bytes};
const PDF=[0x25,0x50,0x44,0x46,0x2d],PNG=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],JPG=[0xff,0xd8,0xff,0xe0];

describe('funding receipt checks (server)',()=>{
 it('requires a file',()=>{
  expect(checkReceipt(null,'application/pdf').error).toMatchObject({status:400,code:'RECEIPT_REQUIRED'});
  expect(checkReceipt(new Uint8Array(0),'application/pdf').error?.code).toBe('RECEIPT_REQUIRED');
 });
 it('refuses other file types, read from the content, and a mislabeled file',()=>{
  expect(checkReceipt(file([0x47,0x49,0x46,0x38]),'image/gif').error).toMatchObject({status:415,code:'RECEIPT_TYPE_NOT_ALLOWED'});
  expect(checkReceipt(new TextEncoder().encode('MZ executable'),'application/pdf').error?.code).toBe('RECEIPT_TYPE_NOT_ALLOWED');
  expect(checkReceipt(file(PNG),'application/pdf').error?.code).toBe('RECEIPT_TYPE_NOT_ALLOWED');
 });
 it('refuses a file over 5 MB',()=>{
  expect(checkReceipt(file(PDF,RECEIPT_MAX_BYTES+1),'application/pdf').error).toMatchObject({status:413,code:'RECEIPT_TOO_LARGE'});
  expect(checkReceipt(file(PDF,RECEIPT_MAX_BYTES),'application/pdf').type).toBe('application/pdf');
 });
 it('accepts a JPG, PNG or PDF',()=>{
  expect(checkReceipt(file(JPG,2048),'image/jpeg')).toEqual({type:'image/jpeg'});
  expect(checkReceipt(file(PNG,2048),'image/png')).toEqual({type:'image/png'});
  expect(checkReceipt(file(PDF,2048),'application/pdf; charset=binary')).toEqual({type:'application/pdf'});
  expect(receiptType(file(PDF))).toBe('application/pdf');
 });
 it('keeps only a safe base name for display',()=>{
  expect(receiptFileName('C:\\Users\\me\\BDO transfer.pdf')).toBe('BDO transfer.pdf');
  expect(receiptFileName('../../etc/"pass"<wd>.png')).toBe('passwd.png');
  expect(receiptFileName('')).toBe('receipt');
 });
});
