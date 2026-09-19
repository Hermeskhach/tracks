import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {upgradeCredential} from '../worker/src/credentials.ts';
const target=process.argv.includes('--remote')?'--remote':'--local';
const secret=readFileSync('.dev.vars','utf8').match(/^PASSWORD_PEPPER="?([a-f0-9]{64})"?$/m)?.[1];
if(!secret)throw new Error('Authentication secret is missing.');
const run=(...args)=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB',target,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const rows=JSON.parse(run('--command','SELECT id,normalizedEmail,passwordHash FROM users','--json'))[0].results;
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const sql=rows.filter(r=>!r.passwordHash.startsWith('tracks-v1$')).map(r=>`UPDATE users SET passwordHash=${quote(upgradeCredential(secret,r.normalizedEmail,r.passwordHash))} WHERE id=${quote(r.id)} AND passwordHash=${quote(r.passwordHash)};`);
if(sql.length) {
 const file='.local/credential-upgrade.sql';writeFileSync(file,sql.join('\n'));
 try {run('--file',file);}catch {throw new Error('Credential upgrade failed; inspect the private migration file locally.');}
 unlinkSync(file);
}
console.log(`Upgraded ${sql.length} credentials (${target}). No passwords changed.`);
