/**
 * Create the store's indexes on whatever MONGODB_URI points at.
 *
 *   npm run db:indexes
 *
 * Run once against a new cluster, and again after changing `ensureIndexes`.
 * It is idempotent, so running it when nothing has changed is a no-op.
 */
import { getDb } from '../src/lib/mongo.ts';
import { ensureIndexes } from '../src/lib/indexes.ts';

const db = await getDb();
await ensureIndexes(db);

const built = await db.collection('spots').indexes();
console.log(`${db.databaseName}.spots:`);
for (const index of built) {
  console.log(`  ${index.name}  ${JSON.stringify(index.key)}${index.unique ? '  unique' : ''}`);
}

process.exit(0);
