#!/usr/bin/env node
import { initDb, getUserByEmail, setAdmin, listAdmins } from '../src/lib/db.js';
import { closeSql } from '../src/lib/sql.js';

await initDb();

const [cmd, ...rest] = process.argv.slice(2);

async function findUser(email) {
  const user = await getUserByEmail(String(email || '').trim().toLowerCase());
  if (!user) {
    console.error(`No account with email "${email}".`);
    process.exit(1);
  }
  return user;
}

switch (cmd) {
  case 'grant-admin': {
    const email = rest[0];
    if (!email) {
      console.error('Usage: npm run users -- grant-admin <email>');
      process.exit(1);
    }
    const user = await findUser(email);
    await setAdmin(user.id, true);
    console.log(`Granted admin to ${user.email}`);
    break;
  }
  case 'revoke-admin': {
    const email = rest[0];
    if (!email) {
      console.error('Usage: npm run users -- revoke-admin <email>');
      process.exit(1);
    }
    const user = await findUser(email);
    await setAdmin(user.id, false);
    console.log(`Revoked admin from ${user.email}`);
    break;
  }
  case 'list-admins': {
    const admins = await listAdmins();
    if (!admins.length) console.log('No admins yet. Grant one with: npm run users -- grant-admin <email>');
    for (const a of admins) {
      console.log(`${a.id}  ${a.email}  ${a.name || ''}  created=${a.created_at}`);
    }
    break;
  }
  default:
    console.log(
      'Usage:\n' +
      '  npm run users -- grant-admin <email>\n' +
      '  npm run users -- revoke-admin <email>\n' +
      '  npm run users -- list-admins'
    );
}

await closeSql();
