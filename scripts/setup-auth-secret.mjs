import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const path='.dev.vars';
let contents=existsSync(path)?readFileSync(path,'utf8'):'';
let secret=contents.match(/^PASSWORD_PEPPER="?([a-f0-9]{64})"?$/m)?.[1];
if(!secret) {
  if(contents.includes('PASSWORD_PEPPER'))throw new Error('Existing secret requires manual inspection; refusing to overwrite.');
  secret=randomBytes(32).toString('hex');
  writeFileSync(path,contents+'\nPASSWORD_PEPPER="'+secret+'"\n');
}
if(process.argv.includes('--remote')) {
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put','PASSWORD_PEPPER'],{input:secret+'\n',encoding:'utf8'});
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  process.exitCode=result.status??1;
} else console.log('Local authentication secret is configured. Keep .dev.vars private and backed up.');
