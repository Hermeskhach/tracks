import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {hashPassword,verifyPassword} from '../src/passwords.ts';
test('salted passwords verify, reject incorrect values, and accept 8 characters',async()=>{
 const a=await hashPassword('Test123!'),b=await hashPassword('Test123!');
 assert.notEqual(a,b);assert.equal(await verifyPassword('Test123!',a),true);assert.equal(await verifyPassword('bad',a),false);
});
test('ASP.NET Identity v3 passwords remain usable after migration',async()=>{
 const salt=randomBytes(16),key=pbkdf2Sync('OriginalPassword!',salt,100000,32,'sha512');
 const bytes=Buffer.alloc(13);bytes[0]=1;bytes.writeUInt32BE(2,1);bytes.writeUInt32BE(100000,5);bytes.writeUInt32BE(16,9);
 const hash=Buffer.concat([bytes,salt,key]).toString('base64');
 assert.equal(await verifyPassword('OriginalPassword!',hash),true);assert.equal(await verifyPassword('wrong',hash),false);
 assert.equal(await verifyPassword('whatever','not-a-valid-hash'),false);
});
