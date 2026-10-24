import type {PayrollRun} from './payrollRuns';

// Reads the payment result file downloaded from the bank portal and matches each row to a payout of the run.
export type BankResultChange={empId:string;status:'Paid'|'Failed';reason?:string};
export type BankResultRow={line:number;employee:string;account:string;status:string;reason:string};
export type BankResult={changes:BankResultChange[];unmatched:BankResultRow[];rows:number};

/** CSV text to rows of cells; quoted cells may hold commas, quotes ("") and line breaks. */
export function parseCsv(text:string){
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch;continue}
  if(ch==='"')quoted=true;
  else if(ch===','||ch==='\t'){row.push(cell);cell=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}
  else cell+=ch;
 }
 if(cell||row.length){row.push(cell);rows.push(row)}
 return rows.map(cells=>cells.map(value=>value.trim())).filter(cells=>cells.some(Boolean));
}

const digits=(value?:string)=>String(value??'').replace(/\D/g,'');
const PAID=/success|paid|credited|posted|complete|accepted|^ok$/i;
const FAILED=/fail|reject|return|invalid|closed|dormant|error|unsuccessful/i;
/** Paid or Failed from the bank's status text; anything else needs manual review. */
export const resultStatus=(text:string):'Paid'|'Failed'|null=>FAILED.test(text)?'Failed':PAID.test(text)?'Paid':null;

const COLUMNS={account:/account|acct|wallet/i,accountNumber:/(account|acct|wallet).*(no|num|#)/i,employee:/employee.*(no|num|id|#)|emp\.?\s*(no|id|#)|empid/i,status:/status|result/i,reason:/remark|reason|message|description|error/i};
type Columns={account:number;employee:number;status:number;reason:number};
/**
 * The file's rows as {employee, account, status, reason}. Two layouts are read: a header row naming the columns
 * (account, employee no., status, remarks), or the bank credit file layout this app exports (H / D / T records) with
 * the bank's status and remarks added after each D record.
 */
function readRows(cells:string[][]):BankResultRow[]{
 if(cells[0]?.[0]==='H')return cells.map((row,index)=>({row,line:index+1})).filter(({row})=>row[0]==='D')
  .map(({row,line})=>({line,account:row[2]??'',employee:row[6]??'',status:row[8]??'',reason:row[9]??''}));
 const headerAt=cells.findIndex(row=>row.some(cell=>COLUMNS.status.test(cell))&&row.some(cell=>COLUMNS.account.test(cell)||COLUMNS.employee.test(cell)));
 if(headerAt<0)throw new Error('The file needs a header row with a status column and an account or employee number column.');
 const header=cells[headerAt];
 const find=(pattern:RegExp,skip:number[]=[])=>header.findIndex((cell,index)=>!skip.includes(index)&&pattern.test(cell));
 const status=find(COLUMNS.status),employee=find(COLUMNS.employee,[status]);
 // "Account Number" over "Account Name".
 const numbered=find(COLUMNS.accountNumber,[status,employee]),account=numbered>=0?numbered:header.findIndex((cell,index)=>![status,employee].includes(index)&&COLUMNS.account.test(cell)&&!/name/i.test(cell));
 const columns:Columns={status,employee,account,reason:find(COLUMNS.reason,[status,employee,account])};
 const at=(row:string[],index:number)=>index<0?'':row[index]??'';
 return cells.slice(headerAt+1).map((row,offset)=>({line:headerAt+offset+2,account:at(row,columns.account),employee:at(row,columns.employee),status:at(row,columns.status),reason:at(row,columns.reason)}))
  .filter(row=>row.account||row.employee);
}

/**
 * Matches each result row to a payout of the run by employee number, otherwise by account (or wallet) number, and
 * returns the Paid and Failed changes for exported payouts. Rows that match no payout, match one not waiting for a
 * result, name a different account than the employee's, repeat an employee or have an unknown status are unmatched.
 */
export function matchBankResult(run:PayrollRun,text:string):BankResult{
 const rows=readRows(parseCsv(text.replace(/^﻿/,'')));
 const lines=Object.entries(run.payouts??{});
 const accountOf=(line:(typeof lines)[number][1])=>digits(line.method==='E-wallet'?line.walletNumber:line.accountNumber);
 const changes:BankResultChange[]=[],unmatched:BankResultRow[]=[],seen=new Set<string>();
 const skip=(row:BankResultRow,reason:string)=>unmatched.push({...row,reason});
 for(const row of rows){
  const employee=row.employee.trim().toUpperCase(),account=digits(row.account);
  const match=(employee?lines.find(([empId])=>empId.toUpperCase()===employee):undefined)
   ??(account?lines.find(([,line])=>accountOf(line)===account):undefined);
  if(!match){skip(row,'No employee or account in this run matches');continue}
  const [empId,line]=match;
  if(account&&accountOf(line)&&accountOf(line)!==account){skip(row,`Account does not match ${empId}'s payout account`);continue}
  if(seen.has(empId)){skip(row,`${empId} appears more than once in the file`);continue}
  seen.add(empId);
  if(line.status!=='Exported'){skip(row,`${empId}'s payout is ${line.status}, not waiting for a result`);continue}
  const status=resultStatus(row.status);
  if(!status){skip(row,`Unknown status "${row.status||'blank'}"`);continue}
  changes.push(status==='Paid'?{empId,status}:{empId,status,reason:`Bank: ${row.reason||row.status}`.slice(0,200)});
 }
 return {changes,unmatched,rows:rows.length};
}
