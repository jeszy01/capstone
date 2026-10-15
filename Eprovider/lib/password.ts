const ITERATIONS=210000;
const encoder=new TextEncoder();
function base64Url(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function fromBase64Url(value:string){const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4);const binary=atob(padded);return Uint8Array.from(binary,c=>c.charCodeAt(0))}
async function derive(password:string,salt:Uint8Array,iterations=ITERATIONS){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt as unknown as BufferSource,iterations,hash:'SHA-256'},key,256))}
export async function hashPassword(password:string){const salt=crypto.getRandomValues(new Uint8Array(16));const digest=await derive(password,salt);return `pbkdf2_sha256$${ITERATIONS}$${base64Url(salt)}$${base64Url(digest)}`}
export async function verifyPassword(password:string,stored:string){const [algorithm,iterationsText,saltText,digestText]=stored.split('$');const iterations=Number(iterationsText);if(algorithm!=='pbkdf2_sha256'||!Number.isInteger(iterations)||iterations<100000||!saltText||!digestText)return false;const expected=fromBase64Url(digestText);const actual=await derive(password,fromBase64Url(saltText),iterations);if(actual.length!==expected.length)return false;let difference=0;for(let i=0;i<actual.length;i++)difference|=actual[i]^expected[i];return difference===0}
/** Password strength rules shared by password changes: 8-128 characters with upper case, lower case, a number and a symbol. */
export function passwordProblems(password:string):string[]{
 const problems:string[]=[];
 if(password.length<8||password.length>128)problems.push('Password must be 8 to 128 characters.');
 if(!/[A-Z]/.test(password)||!/[a-z]/.test(password))problems.push('Password must include upper-case and lower-case letters.');
 if(!/\d/.test(password))problems.push('Password must include a number.');
 if(!/[^A-Za-z0-9]/.test(password))problems.push('Password must include a symbol.');
 return problems;
}
