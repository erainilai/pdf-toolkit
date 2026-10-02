#!/usr/bin/env node
import { initDb, createApiKey, listApiKeys, revokeApiKey } from '../src/lib/db.js';

initDb();

const [cmd, ...rest] = process.argv.slice(2);

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const values = [];
  for (let j = i + 1; j < rest.length && !rest[j].startsWith('--'); j++) values.push(rest[j]);
  return values.length ? values.join(' ') : fallback;
}

switch (cmd) {
  case 'create': {
    const name = flag('name', 'unnamed');
    const { id, rawKey } = createApiKey(name);
    console.log(`Created API key "${name}"`);
    console.log(`  id:  ${id}`);
    console.log(`  key: ${rawKey}`);
    console.log('\nSave this key now — it is hashed in storage and cannot be shown again.');
    break;
  }
  case 'list': {
    const keys = listApiKeys();
    if (!keys.length) console.log('No API keys yet. Create one with: npm run keys -- create --name "Customer name"');
    for (const k of keys) {
      console.log(`${k.id}  ${k.name}  created=${k.created_at}  ${k.revoked_at ? `revoked=${k.revoked_at}` : 'active'}`);
    }
    break;
  }
  case 'revoke': {
    const id = rest[0];
    if (!id) {
      console.error('Usage: npm run keys -- revoke <id>');
      process.exit(1);
    }
    revokeApiKey(id);
    console.log(`Revoked ${id}`);
    break;
  }
  default:
    console.log(
      'Usage:\n' +
      '  npm run keys -- create --name "Customer name"\n' +
      '  npm run keys -- list\n' +
      '  npm run keys -- revoke <id>'
    );
}
