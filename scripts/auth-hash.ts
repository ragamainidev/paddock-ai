/**
 * Credential helpers for AUTH_USERS / AUTH_SECRET (docs/auth.md §6).
 *
 *   pnpm auth:hash <user> [password]   print `user:scrypt$…` for AUTH_USERS;
 *                                      generates a password when none given
 *                                      and prints it once
 *   pnpm auth:secret                   print a fresh AUTH_SECRET
 *
 * Output goes to stdout only; nothing is written to disk.
 */

import { generatePassword, generateSecret, hashPassword } from '../src/auth/credentials';

const [, , cmd, user, password] = process.argv;

if (cmd === 'secret') {
  console.log(generateSecret());
} else if (cmd === 'hash') {
  if (!user || user.includes(':') || user.includes(',') || user.length > 64) {
    console.error('usage: pnpm auth:hash <user> [password]   (user: no ":" or ",", ≤ 64 chars)');
    process.exit(2);
  }
  const pw = password ?? generatePassword();
  const line = `${user}:${hashPassword(pw)}`;
  if (!password) console.error(`password for ${user} (shown once): ${pw}`);
  console.log(line);
} else {
  console.error('usage: pnpm auth:hash <user> [password] | pnpm auth:secret');
  process.exit(2);
}
