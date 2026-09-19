import { challenge, checkTicket, credential, newParameters, parameters, upgradeCredential, verifyCredential } from './credentials';
import { addExamples } from './samples';

interface Env { DB: D1Database; ASSETS: Fetcher; PASSWORD_PEPPER:string }
type Row = Record<string, any>;
const trackColumns = 'id,name,description,icon,color,archived,createdAt';
const activityColumns = 'id,projectId,date,title,description,value,unit,createdAt,updatedAt';
const cookieName = 'tracks.cf.session';
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => Response.json(value, {status, headers});
const empty = () => new Response(null, {status:204});
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function requireThat(condition: unknown, message: string, status = 400): asserts condition { if (!condition) throw new HttpError(status,message); }
const text = (x: unknown, max: number, required = false): x is string => typeof x === 'string' && x.length <= max && (!required || x.trim().length > 0);
const now = () => new Date().toISOString();
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(); }
const trackView = (t: Row) => ({id:t.id,name:t.name,description:t.description,icon:t.icon,color:t.color,archived:!!t.archived,createdAt:t.createdAt});
function statement(env:Env,sql:string,...args:any[]) { return env.DB.prepare(sql).bind(...args); }
async function first(env:Env,sql:string,...args:any[]) { return statement(env,sql,...args).first<Row>(); }
async function list(env:Env,sql:string,...args:any[]) { return (await statement(env,sql,...args).all<Row>()).results; }
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function validateTrack(b:Row) {
  requireThat(text(b.name,80,true),'Track name must be 1–80 characters.');
  requireThat(b.description == null || text(b.description,500),'Description must be at most 500 characters.');
  requireThat(text(b.icon,20,true),'Choose an icon.');
  requireThat(['green','blue','purple','orange','pink'].includes(b.color),'Choose a track color.');
  requireThat(b.archived == null || typeof b.archived === 'boolean','Invalid archived value.');
}
function validateActivity(b:Row) {
  requireThat(text(b.title,200,true),'Activity title must be 1–200 characters.');
  requireThat(b.description == null || text(b.description,5000),'Notes must be at most 5,000 characters.');
  requireThat(validDate(b.date) && b.date >= '1900-01-01' && b.date <= new Date(Date.now()+86400000).toISOString().slice(0,10),'Choose a valid activity date, no later than today.');
  requireThat(b.value == null || (typeof b.value === 'number' && Number.isFinite(b.value) && b.value >= 0 && b.value <= 1e9),'Value must be between 0 and 1 billion.');
  requireThat(b.value == null ? b.unit == null || text(b.unit,30) : text(b.unit,30,true),'Add a unit (up to 30 characters).');
}
async function readBody(req:Request): Promise<Row> {
  requireThat(req.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json','Expected JSON.',415);
  const reader = req.body?.getReader(); if (!reader) return {};
  let size = 0; const chunks:Uint8Array[] = [];
  for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw new HttpError(413,'Request is too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {const value=JSON.parse(new TextDecoder().decode(bytes));requireThat(value && typeof value==='object' && !Array.isArray(value),'Invalid JSON.');return value;} catch {throw new HttpError(400,'Invalid JSON.');}
}
function sessionCookie(req:Request, value:string, age=1209600) {
  const url=new URL(req.url);const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${url.protocol==='https:' || !local?'; Secure':''}`;
}
function cookieToken(req:Request) { return req.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1) || ''; }
async function sessionUser(req:Request,env:Env) {
  const raw=cookieToken(req);if(!/^[a-f0-9]{64}$/.test(raw))return null;
  return first(env,'SELECT u.id,u.email,u.displayName FROM users u JOIN sessions s ON s.userId=u.id WHERE s.tokenHash=? AND s.expiresAt>?',await hash(raw),Date.now());
}
async function newSession(req:Request,env:Env,user:Row) {
  const raw=token(); const time=Date.now();
  await env.DB.batch([statement(env,'DELETE FROM sessions WHERE expiresAt<=?',time),statement(env,'INSERT INTO sessions(tokenHash,userId,expiresAt) VALUES(?,?,?)',await hash(raw),user.id,time+1209600000)]);
  return json({displayName:user.displayName,email:user.email},200,{'Set-Cookie':sessionCookie(req,raw)});
}
async function authLimit(req:Request,env:Env) {
  const time=Date.now(), bucket=Math.floor(time/60000);
  const key=await hash(`${req.headers.get('CF-Connecting-IP') || 'local'}:${new URL(req.url).pathname.endsWith('/challenge')?'challenge':'attempt'}:${bucket}`);
  const results=await env.DB.batch([statement(env,'DELETE FROM auth_limits WHERE expiresAt<?',time),statement(env,'INSERT INTO auth_limits(key,count,expiresAt) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',key,time+120000)]);
  requireThat(Number((results[1].results[0] as Row)?.['count'])<=20,'Too many attempts. Please wait a minute.',429);
}
async function auth(req:Request,env:Env,path:string) {
  await authLimit(req,env);const b=await readBody(req);
  requireThat(text(b.email,254,true) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email),'Enter a valid email.');
  const email=b.email.trim(),normalized=email.toUpperCase();
  let user=await first(env,'SELECT * FROM users WHERE normalizedEmail=?',normalized);
  if(user) {
    const upgraded=upgradeCredential(env.PASSWORD_PEPPER,normalized,user.passwordHash);
    if(upgraded!==user.passwordHash)await statement(env,'UPDATE users SET passwordHash=? WHERE id=? AND passwordHash=?',upgraded,user.id,user.passwordHash).run();
    user.passwordHash=upgraded;
  }
  if(path==='/api/auth/challenge') {
    requireThat(['register','login'].includes(b.mode),'Invalid authentication mode.');
    return json(challenge(env.PASSWORD_PEPPER,normalized,b.mode,b.mode==='register'?newParameters():user?parameters(user.passwordHash):undefined));
  }
  const mode=path.endsWith('/register')?'register':'login';
  const params=checkTicket(env.PASSWORD_PEPPER,normalized,mode,b.ticket);
  requireThat(params,'Sign-in expired. Please try again.');
  requireThat(typeof b.proof==='string' && /^[a-f0-9]+$/.test(b.proof) && b.proof.length===params.length*2,'Invalid sign-in credential.');
  if(path==='/api/auth/register') {
    requireThat(text(b.name,80,true),'Enter a name (up to 80 characters).');
    const passwordHash=credential(env.PASSWORD_PEPPER,normalized,b.proof,params);const user={id:crypto.randomUUID(),email,displayName:b.name.trim()};
    const inserted=await statement(env,'INSERT INTO users(id,email,normalizedEmail,displayName,passwordHash,createdAt) VALUES(?,?,?,?,?,?) ON CONFLICT(normalizedEmail) DO NOTHING',user.id,email,normalized,user.displayName,passwordHash,now()).run();
    requireThat(inserted.meta.changes===1,'Unable to create an account with this email. Try signing in.');
    return newSession(req,env,user);
  }
  const message='Unable to sign in. Check your details, or try again later.';
  requireThat(user && user.lockoutUntil<=Date.now(),message,401);
  if(!verifyCredential(env.PASSWORD_PEPPER,normalized,b.proof,user.passwordHash,params)) {
    await statement(env,'UPDATE users SET failedAttempts=CASE WHEN failedAttempts>=4 THEN 0 ELSE failedAttempts+1 END, lockoutUntil=CASE WHEN failedAttempts>=4 THEN ? ELSE lockoutUntil END WHERE id=?',Date.now()+300000,user.id).run();
    throw new HttpError(401,message);
  }
  await statement(env,'UPDATE users SET failedAttempts=0,lockoutUntil=0 WHERE id=?',user.id).run();
  return newSession(req,env,user);
}
async function route(req:Request,env:Env) {
  const url=new URL(req.url),path=url.pathname,method=req.method;
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
  if(!['GET','HEAD'].includes(method)) {
    requireThat(req.headers.get('X-Tracks-Request')==='1','Request not allowed.',403);
    const origin=req.headers.get('Origin');requireThat(!origin || origin===url.origin,'Request not allowed.',403);
    requireThat(req.headers.get('Sec-Fetch-Site')!=='cross-site','Request not allowed.',403);
  }
  if(path==='/api/health' && method==='GET')return json({status:'ok',runtime:'cloudflare-workers',database:'d1'});
  if(['/api/auth/register','/api/auth/login','/api/auth/challenge'].includes(path) && method==='POST')return auth(req,env,path);
  const shared=path.match(/^\/api\/shared\/([a-fA-F0-9]{64})$/);
  if(shared && method==='GET') {
    const s=await first(env,'SELECT t.* FROM tracks t JOIN share_links s ON s.projectId=t.id WHERE s.tokenHash=? AND s.enabled=1 AND (s.expiresAt IS NULL OR s.expiresAt>?)',await hash(shared[1]),now());
    requireThat(s,'This page or link is no longer available.',404);
    return json({track:trackView(s),activities:await list(env,`SELECT ${activityColumns} FROM activities WHERE projectId=? ORDER BY date DESC,createdAt DESC`,s.id)});
  }
  if(path.startsWith('/api/shared/'))throw new HttpError(404,'This page or link is no longer available.');
  const user=await sessionUser(req,env);requireThat(user,'Please sign in to continue.',401);
  if(path==='/api/auth/me' && method==='GET')return json({email:user.email,displayName:user.displayName});
  if(path==='/api/auth/logout' && method==='POST') {
    await statement(env,'DELETE FROM sessions WHERE tokenHash=?',await hash(cookieToken(req))).run();
    return new Response(null,{status:204,headers:{'Set-Cookie':sessionCookie(req,'',0)}});
  }
  if(path==='/api/projects' && method==='GET')return json({tracks:(await list(env,`SELECT ${trackColumns} FROM tracks WHERE userId=? ORDER BY createdAt`,user.id)).map(trackView),activities:await list(env,'SELECT a.* FROM activities a JOIN tracks t ON t.id=a.projectId WHERE t.userId=? ORDER BY a.date DESC,a.createdAt DESC',user.id)});
  if(path==='/api/projects' && method==='POST') {
    const b=await readBody(req);validateTrack(b);const t={id:crypto.randomUUID(),name:b.name.trim(),description:b.description?.trim()||'',icon:b.icon,color:b.color,archived:!!b.archived,createdAt:now()};
    await statement(env,'INSERT INTO tracks(id,userId,name,description,icon,color,archived,createdAt) VALUES(?,?,?,?,?,?,?,?)',t.id,user.id,t.name,t.description,t.icon,t.color,Number(t.archived),t.createdAt).run();return json(t,201);
  }
  if(path==='/api/examples' && method==='POST') {
    const today=url.searchParams.get('today')||now().slice(0,10);
    requireThat(validDate(today) && Math.abs(Date.parse(today)-Date.parse(now().slice(0,10)))<=86400000,'Invalid local date.');
    requireThat(!await first(env,'SELECT id FROM tracks WHERE userId=? LIMIT 1',user.id),'Example tracks can only be added to an empty journal.');
    await addExamples(env.DB,user.id,today);return empty();
  }
  const project=path.match(/^\/api\/projects\/([^/]+)(?:\/(activities|heatmap|share))?$/);
  if(project) {
    const t=await first(env,'SELECT * FROM tracks WHERE id=? AND userId=?',project[1],user.id);requireThat(t,'Not found.',404);
    const sub=project[2];
    if(!sub && method==='PUT') {const b=await readBody(req);validateTrack(b);await statement(env,'UPDATE tracks SET name=?,description=?,icon=?,color=?,archived=? WHERE id=? AND userId=?',b.name.trim(),b.description?.trim()||'',b.icon,b.color,Number(!!b.archived),t.id,user.id).run();return json(trackView({...t,...b,name:b.name.trim(),description:b.description?.trim()||''}));}
    if(!sub && method==='DELETE') {await statement(env,'UPDATE tracks SET archived=1 WHERE id=? AND userId=?',t.id,user.id).run();return empty();}
    if(sub==='activities' && method==='GET')return json(await list(env,`SELECT ${activityColumns} FROM activities WHERE projectId=? ORDER BY date DESC,createdAt DESC`,t.id));
    if(sub==='activities' && method==='POST') {
      requireThat(!t.archived,'Restore this track before logging an activity.');const b=await readBody(req);validateActivity(b);
      const a={id:crypto.randomUUID(),projectId:t.id,date:b.date,title:b.title.trim(),description:b.description?.trim()||'',value:b.value??null,unit:b.value==null?null:b.unit.trim(),createdAt:now(),updatedAt:now()};
      await statement(env,'INSERT INTO activities(id,projectId,date,title,description,value,unit,createdAt,updatedAt) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tracks WHERE id=? AND userId=? AND archived=0)',a.id,a.projectId,a.date,a.title,a.description,a.value,a.unit,a.createdAt,a.updatedAt,t.id,user.id).run();return json(a,201);
    }
    if(sub==='heatmap' && method==='GET') {
      const year=Number(url.searchParams.get('year')||new Date().getUTCFullYear());requireThat(Number.isInteger(year)&&year>=1900&&year<=9998,'Invalid year.');
      const counts=await list(env,'SELECT date,COUNT(*) AS count FROM activities WHERE projectId=? AND date>=? AND date<? GROUP BY date',t.id,`${year}-01-01`,`${year+1}-01-01`);
      const map=new Map(counts.map(c=>[c.date,c.count]));const days=[];for(let d=new Date(`${year}-01-01T00:00:00Z`);d.getUTCFullYear()===year;d.setUTCDate(d.getUTCDate()+1)){const date=d.toISOString().slice(0,10);days.push({date,count:map.get(date)||0});}return json(days);
    }
    if(sub==='share') {
      if(method==='GET') {const s=await first(env,'SELECT enabled,expiresAt FROM share_links WHERE projectId=?',t.id);return json({enabled:!!s?.enabled&&(!s.expiresAt||s.expiresAt>now()),expiresAt:s?.expiresAt??null});}
      if(method==='DELETE') {await statement(env,'UPDATE share_links SET enabled=0 WHERE projectId=?',t.id).run();return empty();}
      if(method==='POST') {
        const b=await readBody(req);requireThat(b.expiresAt==null || (typeof b.expiresAt==='string' && Number.isFinite(Date.parse(b.expiresAt)) && Date.parse(b.expiresAt)>Date.now()),'Choose an expiry in the future.');
        const expiresAt=b.expiresAt==null?null:new Date(b.expiresAt).toISOString();const raw=token();
        await statement(env,'INSERT INTO share_links(id,projectId,tokenHash,enabled,expiresAt,createdAt) VALUES(?,?,?,1,?,?) ON CONFLICT(projectId) DO UPDATE SET tokenHash=excluded.tokenHash,enabled=1,expiresAt=excluded.expiresAt',crypto.randomUUID(),t.id,await hash(raw),expiresAt,now()).run();return json({token:raw,expiresAt});
      }
    }
  }
  const activity=path.match(/^\/api\/activities\/([^/]+)$/);
  if(activity && ['PUT','DELETE'].includes(method)) {
    const a=await first(env,'SELECT a.*,t.archived FROM activities a JOIN tracks t ON t.id=a.projectId WHERE a.id=? AND t.userId=?',activity[1],user.id);requireThat(a,'Not found.',404);
    if(method==='DELETE'){await statement(env,'DELETE FROM activities WHERE id=?',a.id).run();return empty();}
    requireThat(!a.archived,'Restore this track before editing activities.');const b=await readBody(req);validateActivity(b);
    await statement(env,'UPDATE activities SET date=?,title=?,description=?,value=?,unit=?,updatedAt=? WHERE id=?',b.date,b.title.trim(),b.description?.trim()||'',b.value??null,b.value==null?null:b.unit.trim(),now(),a.id).run();
    return json(await first(env,`SELECT ${activityColumns} FROM activities WHERE id=?`,a.id));
  }
  throw new HttpError(404,'Not found.');
}
export default {
  async fetch(req:Request,env:Env):Promise<Response> {
    let response:Response;
    try {response=await route(req,env);}catch(e){if(e instanceof HttpError)response=json({message:e.message},e.status);else{console.error('Request failed',e instanceof Error?e.message:'Unknown error');response=json({message:'Something went wrong. Please try again.'},500);}}
    const result=new Response(response.body,response);result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('Referrer-Policy','no-referrer');
    if(new URL(req.url).pathname.startsWith('/api/'))result.headers.set('Cache-Control','no-store');return result;
  }
} satisfies ExportedHandler<Env>;
