export interface PasswordChallenge { salt:string; iterations:number; digest:string; length:number; ticket:string }
export function validatePassword(password:string) {
  if(password.length<8 || password.length>128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password))
    throw new Error('Use 8+ characters with uppercase, lowercase, a number, and a symbol.');
}
// This derived credential is password-equivalent: send only over HTTPS and never persist it.
export async function passwordProof(password:string, challenge:PasswordChallenge):Promise<string> {
  if(!Number.isInteger(challenge.iterations) || challenge.iterations<1000 || challenge.iterations>1000000 || !['SHA-1','SHA-256','SHA-512'].includes(challenge.digest) || challenge.length<16 || challenge.length>64)
    throw new Error('Invalid sign-in challenge.');
  const salt=Uint8Array.from(atob(challenge.salt),c=>c.charCodeAt(0));
  if(salt.length<16 || salt.length>64)throw new Error('Invalid sign-in challenge.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:challenge.iterations,hash:challenge.digest},key,challenge.length*8);
  return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
