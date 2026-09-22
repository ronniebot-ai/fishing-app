/**
 * Check the store for the things that go wrong in it.
 *
 *   npm run db:audit          report only
 *   npm run db:audit -- --fix report, then put right what can be
 *
 * Read the report before passing --fix. Merging near-duplicates deletes spots,
 * and the tool picks the oldest of a cluster to keep, which is a guess about
 * intent rather than a fact.
 */
import { applyFixes, audit } from '../src/lib/audit.ts';
import { getDb } from '../src/lib/mongo.ts';

const fix = process.argv.includes('--fix');
const db = await getDb();

function report(findings: Awaited<ReturnType<typeof audit>>): number {
  const width = Math.max(...findings.map((f) => f.check.length));
  let total = 0;

  for (const finding of findings) {
    total += finding.count;
    const flag = finding.count === 0 ? '  ok ' : finding.fixable ? ' fix ' : ' look';
    console.log(`${flag} ${finding.check.padEnd(width)}  ${String(finding.count).padStart(5)}  ${finding.description}`);
    for (const example of finding.examples) {
      console.log(`        ${JSON.stringify(example)}`);
    }
  }
  return total;
}

console.log(`${db.databaseName}\n`);
const before = await audit(db);
const total = report(before);

if (total === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

if (!fix) {
  console.log('\nRe-run with --fix to repair what is marked "fix".');
  process.exit(0);
}

console.log('\nfixing...\n');
for (const result of await applyFixes(db)) {
  console.log(`  ${result.check}: ${result.action} (${result.count})`);
}

console.log('\nafter:\n');
const remaining = report(await audit(db));
console.log(remaining === 0 ? '\nClean.' : '\nSome findings need a person.');

process.exit(0);
