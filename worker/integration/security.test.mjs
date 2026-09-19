import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync,randomBytes,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {passwordProof,validatePassword} from '../../web/src/app/password-proof.ts';
const base=process.env.TRACKS_TEST_URL || 'http://127.0.0.1:5082';
assert.equal(new URL(base).hostname,'127.0.0.1','Security fixture tests must target the isolated local test instance.');
const fixtureId='migration-'+Date.now(), fixtureEmail=fixtureId+'@example.com', fixturePassword='Legacy12!';
const salt=randomBytes(16), head=Buffer.alloc(13);head[0]=1;head.writeUInt32BE(2,1);head.writeUInt32BE(100000,5);head.writeUInt32BE(16,9);
const legacyHash=Buffer.concat([head,salt,pbkdf2Sync(fixturePassword,salt,100000,32,'sha512')]).toString('base64');
const expiredRaw=randomBytes(32).toString('hex'), expiredHash=createHash('sha256').update(expiredRaw).digest('hex').toUpperCase();
writeFileSync('.local/security-fixture.sql',`INSERT INTO users(id,email,normalizedEmail,displayName,passwordHash,createdAt) VALUES('${fixtureId}','${fixtureEmail}','${fixtureEmail.toUpperCase()}','Migrated account','${legacyHash}','2026-01-01T00:00:00.000Z');\nINSERT INTO sessions(tokenHash,userId,expiresAt) VALUES('${expiredHash}','${fixtureId}',1);`);
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--persist-to','.local/d1-tests','--file','.local/security-fixture.sql'],{stdio:'pipe'});
async function call(path,method='GET',body,cookie='',extra={}) {
 if(['/api/auth/register','/api/auth/login'].includes(path) && body?.password) {
  if(path.endsWith('/register'))validatePassword(body.password);
  const response=await call('/api/auth/challenge','POST',{email:body.email,mode:path.split('/').at(-1)});
  assert.equal(response.status,200);const challenge=await response.json();
  const {password,...rest}=body;body={...rest,proof:await passwordProof(password,challenge),ticket:challenge.ticket};
 }
 return fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Tracks-Request':'1',...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
}
test('legacy password login, session revocation and expiration',async()=>{
 const login=await call('/api/auth/login','POST',{email:fixtureEmail,password:fixturePassword});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const session=cookie.split(';')[0];assert.equal((await call('/api/auth/me','GET',undefined,session)).status,200);
 assert.equal((await call('/api/auth/me','GET',undefined,'tracks.cf.session='+expiredRaw)).status,401);
 assert.equal((await call('/api/auth/logout','POST',undefined,session)).status,204);
 assert.equal((await call('/api/auth/me','GET',undefined,session)).status,401);
});
test('8-character passwords, origin checks, examples, and validation',async()=>{
 const email='security-'+Date.now()+'@example.com';
 await assert.rejects(call('/api/auth/register','POST',{name:'Test',email,password:'Abc123!'}),/8\+/);
 const registered=await call('/api/auth/register','POST',{name:'Test',email,password:'Abcd123!'});assert.equal(registered.status,200);
 const cookie=registered.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/projects','POST',{},cookie,{Origin:'https://other.example'})).status,403);
 assert.equal((await call('/api/projects','POST',{name:123},cookie)).status,400);
 assert.equal((await call('/api/examples','POST',undefined,cookie)).status,204);
 const data=await(await call('/api/projects','GET',undefined,cookie)).json();assert.equal(data.tracks.length,5);assert.equal(data.activities.length,35);
 assert.equal((await call('/api/examples','POST',undefined,cookie)).status,400);
 const path='/api/projects/'+data.tracks[0].id+'/activities';
 assert.equal((await call(path,'POST',{date:'2026-02-30',title:'Nope'},cookie)).status,400);
 assert.equal((await call(path,'POST',{date:'2026-01-01',title:'Nope',value:1,unit:''},cookie)).status,400);
 assert.equal((await call('/api/projects','POST',{name:'x'.repeat(40000)},cookie)).status,413);
 const missing=await call('/api/shared/'+'a'.repeat(64));assert.equal(missing.status,404);assert.equal(missing.headers.get('Cache-Control'),'no-store');
 const page=await fetch(base+'/track/'+data.tracks[0].id);assert.equal(page.status,200);assert.match(page.headers.get('Content-Type'),/text\/html/);
 assert.ok(page.headers.get('Content-Security-Policy'));assert.equal(page.headers.get('Referrer-Policy'),'no-referrer');
});
test('five failed passwords lock the account without accepting the correct password',async()=>{
 for(let i=0;i<5;i++)assert.equal((await call('/api/auth/login','POST',{email:fixtureEmail,password:'Incorrect12!'})).status,401);
 assert.equal((await call('/api/auth/login','POST',{email:fixtureEmail,password:fixturePassword})).status,401);
});
