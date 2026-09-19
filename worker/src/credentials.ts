import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';

interface Parameters {salt:string; iterations:number; digest:string; length:number}
interface Credential extends Parameters {verifier:string; version:1}
interface Ticket extends Parameters {email:string; mode:string; expires:number}
function mac(secret:string,domain:string,value:string) {
  if(!secret || secret.length<64)throw new Error('Authentication secret is not configured.');
  return createHmac('sha256',secret).update(domain+'\0'+value).digest('hex');
}
function equal(a:string,b:string) {return a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function verifier(secret:string,email:string,proof:string) {return mac(secret,'tracks-credential-v1',email+'\0'+proof);}
export function newParameters():Parameters {return {salt:Buffer.from(randomBytes(16)).toString('base64'),iterations:210000,digest:'SHA-512',length:32};}
export function credential(secret:string,email:string,proof:string,p:Parameters):string {
  return 'tracks-v1$'+JSON.stringify({version:1,salt:p.salt,iterations:p.iterations,digest:p.digest,length:p.length,verifier:verifier(secret,email,proof)});
}
// Wrap the existing Identity/PBKDF2 subkey without knowing or changing the user's password.
export function upgradeCredential(secret:string,email:string,encoded:string):string {
  if(encoded.startsWith('tracks-v1$'))return encoded;
  let salt:Buffer,key:Buffer,iterations:number,digest:string;
  if(encoded.startsWith('pbkdf2-sha512$')) {
    const parts=encoded.split('$');iterations=Number(parts[1]);digest='SHA-512';salt=Buffer.from(parts[2],'base64');key=Buffer.from(parts[3],'base64');
  } else {
    const data=Buffer.from(encoded,'base64');
    if(data[0]!==1 || data.length<45)throw new Error('Unsupported legacy credential.');
    digest=['SHA-1','SHA-256','SHA-512'][data.readUInt32BE(1)];iterations=data.readUInt32BE(5);
    const size=data.readUInt32BE(9);salt=data.subarray(13,13+size);key=data.subarray(13+size);
  }
  if(!digest || iterations<1000 || iterations>1000000 || salt.length<16 || salt.length>64 || key.length<16 || key.length>64)throw new Error('Invalid legacy credential.');
  return credential(secret,email,Buffer.from(key).toString('hex'),{salt:Buffer.from(salt).toString('base64'),iterations,digest,length:key.length});
}
export function parameters(encoded:string):Parameters {
  const c=JSON.parse(encoded.slice('tracks-v1$'.length)) as Credential;
  return {salt:c.salt,iterations:c.iterations,digest:c.digest,length:c.length};
}
export function challenge(secret:string,email:string,mode:string,p?:Parameters) {
  const params=p || {salt:Buffer.from(mac(secret,'tracks-unknown-salt',email),'hex').subarray(0,16).toString('base64'),iterations:210000,digest:'SHA-512',length:32};
  const payload=Buffer.from(JSON.stringify({...params,email,mode,expires:Date.now()+300000})).toString('base64url');
  return {...params,ticket:payload+'.'+mac(secret,'tracks-challenge-v1',payload)};
}
export function checkTicket(secret:string,email:string,mode:string,ticket:unknown):Ticket|null {
  try {
    if(typeof ticket!=='string' || ticket.length>2048)return null;
    const [payload,signature,...extra]=ticket.split('.');
    if(extra.length || !signature || !equal(mac(secret,'tracks-challenge-v1',payload),signature))return null;
    const value=JSON.parse(Buffer.from(payload,'base64url').toString()) as Ticket;
    return value.email===email && value.mode===mode && value.expires>Date.now()?value:null;
  } catch {return null;}
}
export function verifyCredential(secret:string,email:string,proof:string,encoded:string,p:Parameters):boolean {
  const c=JSON.parse(encoded.slice('tracks-v1$'.length)) as Credential;
  return c.salt===p.salt && c.iterations===p.iterations && c.digest===p.digest && c.length===p.length && equal(c.verifier,verifier(secret,email,proof));
}
