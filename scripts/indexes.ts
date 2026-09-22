/**
 * Create the store's indexes on whatever MONGODB_URI points at.
 *
 *   npm run db:indexes
 *
 * Run once against a new cluster, and again after changing `ensureIndexes`.
 * It is idempotent, so running it when nothing has changed is a no-op.
 */
import { getDb } from '../src/lib/mongo.ts';
import { CONDITIONS, ensureIndexes, SPOTS } from '../src/lib/indexes.ts';

const db = await getDb();
await ensureIndexes(db);

for (const name of [SPOTS, CONDITIONS]) {
  const built = await db.collection(name).indexes();
  console.log(`${db.databaseName}.${name}:`);
  for (const index of built) {
    const bits = [
      index.unique ? 'unique' : null,
      index.expireAfterSeconds !== undefined ? `ttl=${index.expireAfterSeconds}s` : null,
    ].filter(Boolean);
    console.log(`  ${index.name}  ${JSON.stringify(index.key)}${bits.length ? '  ' + bits.join(' ') : ''}`);
  }
}

process.exit(0);
