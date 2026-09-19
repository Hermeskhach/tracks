import { readFile, writeFile, mkdir } from 'node:fs/promises';
import pg from 'pg';
const config = JSON.parse(await readFile(new URL('../.local/database.json',import.meta.url),'utf8'));
const client = new pg.Client({host:'127.0.0.1',port:config.Port,database:'tracks',user:'tracks',password:config.Password});
const quote = value => value == null ? 'NULL' : typeof value==='number' ? String(value) : typeof value==='boolean' ? String(Number(value)) : "'"+String(value instanceof Date?value.toISOString():value).replaceAll("'","''")+"'";
const rows=[];const counts={users:0,tracks:0,activities:0,share_links:0};
function insert(table,object) {rows.push(`INSERT INTO ${table} (${Object.keys(object).join(',')}) VALUES (${Object.values(object).map(quote).join(',')});`);counts[table]++;}
await client.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const users=(await client.query('SELECT * FROM "AspNetUsers" ORDER BY "Id"')).rows.filter(u=>! /^(api-|ui-|layout-|password-check-).*@example\.com$/i.test(u.Email));
  const ids=users.map(u=>u.Id);
  for(const u of users) {if(!u.PasswordHash)throw new Error('An account has no password hash; export stopped.');insert('users',{id:u.Id,email:u.Email,normalizedEmail:u.Email.trim().toUpperCase(),displayName:u.DisplayName,passwordHash:u.PasswordHash,failedAttempts:u.AccessFailedCount,lockoutUntil:u.LockoutEnd?new Date(u.LockoutEnd).getTime():0,createdAt:new Date().toISOString()});}
  const tracks=(await client.query('SELECT * FROM "Tracks" WHERE "UserId"=ANY($1::text[])',[ids])).rows;
  for(const t of tracks) insert('tracks',{id:t.Id,userId:t.UserId,name:t.Name,description:t.Description,icon:t.Icon,color:t.Color,archived:t.Archived,createdAt:t.CreatedAt});
  const trackIds=tracks.map(t=>t.Id);
  for(const a of (await client.query('SELECT *, "Date"::text AS day FROM "Activities" WHERE "TrackId"=ANY($1::uuid[])',[trackIds])).rows)insert('activities',{id:a.Id,projectId:a.TrackId,date:a.day,title:a.Title,description:a.Description,value:a.Value===null?null:Number(a.Value),unit:a.Unit,createdAt:a.CreatedAt,updatedAt:a.UpdatedAt});
  for(const s of (await client.query('SELECT * FROM "ShareLinks" WHERE "TrackId"=ANY($1::uuid[])',[trackIds])).rows)insert('share_links',{id:s.Id,projectId:s.TrackId,tokenHash:s.TokenHash.toUpperCase(),enabled:s.Enabled,expiresAt:s.ExpiresAt,createdAt:s.CreatedAt});
  await client.query('COMMIT');
  await mkdir(new URL('../.local/',import.meta.url),{recursive:true});
  await writeFile(new URL('../.local/postgres-to-d1.sql',import.meta.url),rows.join('\n')+'\n',{mode:0o600});
  await writeFile(new URL('../.local/postgres-to-d1-counts.json',import.meta.url),JSON.stringify(counts,null,2));
  console.log('Read-only export complete. Generated test accounts excluded. Records:',counts);
  console.log('Private export saved in .local/postgres-to-d1.sql. Import once into an empty migrated D1 database.');
} finally {await client.end();}
