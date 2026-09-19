import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {challenge,checkTicket,credential,newParameters,parameters,upgradeCredential,verifyCredential} from '../src/credentials.ts';
import {passwordProof,validatePassword} from '../../web/src/app/password-proof.ts';
const secret=randomBytes(32).toString('hex'),email='TEST@EXAMPLE.COM';
test('browser password policy accepts eight characters and rejects seven',()=>{
 assert.doesNotThrow(()=>validatePassword('Abcd123!'));assert.throws(()=>validatePassword('Abc123!'));
 for(const p of ['abcdefgh','ABCDEFGH','12345678','Abcd1234'])assert.throws(()=>validatePassword(p));
});
test('signed challenges bind account, mode, parameters, and expiration',()=>{
 const c=challenge(secret,email,'register',newParameters());
 assert.ok(checkTicket(secret,email,'register',c.ticket));
 assert.equal(checkTicket(secret,'OTHER@EXAMPLE.COM','register',c.ticket),null);
 assert.equal(checkTicket(secret,email,'login',c.ticket),null);
 const [payload,sig]=c.ticket.split('.');const decoded=JSON.parse(Buffer.from(payload,'base64url'));
 decoded.iterations=1;const changed=Buffer.from(JSON.stringify(decoded)).toString('base64url');
 assert.equal(checkTicket(secret,email,'register',changed+'.'+sig),null);
 const original=Date.now;try {Date.now=()=>original()+310000;assert.equal(checkTicket(secret,email,'register',c.ticket),null);}finally{Date.now=original;}
});
test('browser derivation and peppered verification protect database credentials',async()=>{
 const c=challenge(secret,email,'register',newParameters()),proof=await passwordProof('Abcd123!',c);
 const stored=credential(secret,email,proof,c);
 assert.ok(!stored.includes(proof));assert.ok(verifyCredential(secret,email,proof,stored,c));
 assert.ok(!verifyCredential(secret,email,'00'.repeat(32),stored,c));
 assert.ok(!verifyCredential('00'.repeat(32),email,proof,stored,c));
 assert.ok(!verifyCredential(secret,'OTHER@EXAMPLE.COM',proof,stored,c));
});
test('Identity migration retains the original password without retaining its subkey',async()=>{
 const salt=randomBytes(16),head=Buffer.alloc(13);head[0]=1;head.writeUInt32BE(2,1);head.writeUInt32BE(100000,5);head.writeUInt32BE(16,9);
 const key=pbkdf2Sync('Legacy12!',salt,100000,32,'sha512');
 const old=Buffer.concat([head,salt,key]).toString('base64');
 const stored=upgradeCredential(secret,email,old),p=parameters(stored),c=challenge(secret,email,'login',p);
 assert.equal(upgradeCredential(secret,email,stored),stored);
 assert.ok(!stored.includes(key.toString('hex')));assert.ok(!stored.includes(key.toString('base64')));
 assert.ok(verifyCredential(secret,email,await passwordProof('Legacy12!',c),stored,p));
 assert.ok(!verifyCredential(secret,email,await passwordProof('Wrong12!',c),stored,p));
});
