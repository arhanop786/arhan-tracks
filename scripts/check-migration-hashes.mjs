// Verify the migration's pre-computed hash literals against the fixed pin.ts.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = readFileSync('src/server/pin.ts', 'utf8').replace(
  /import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?/g,
  "const DEFAULT_STAFF_PIN='246810';",
);
const tmp = mkdtempSync(join(tmpdir(), 'chk-'));
const f = join(tmp, 'pin.ts');
writeFileSync(f, src);
const m = await import('file:///' + f.replace(/\\/g, '/'));

const h1 = 'pbkdf2-sha256$120000$314d5b1fe5f138288140356ea6fdf123$d5388e8375193a4a243844330c36e465d5b1c0b73b6481cb06d0fc475671cf8f';
const h2 = 'pbkdf2-sha256$120000$a51a8a3e94838970d9ee3a7bcab656bb$057df8ea17ef08cf29e6202caee31a28d90d0ecc4c66c5cd2f1c183e084f41d2';

let bad = 0;
const check = (label, got, want) => { console.log(label, got === want ? 'OK' : 'BAD'); if (got !== want) bad++; };
check('1111 accepts  ', m.verifyPin(h1, '1111'), true);
check('1111 rejects  ', m.verifyPin(h1, '1112'), false);
check('2222 accepts  ', m.verifyPin(h2, '2222'), true);
check('2222 rejects  ', m.verifyPin(h2, '2223'), false);
rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
