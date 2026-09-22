import { MongoClient, type Db } from 'mongodb';

/**
 * The connection to Atlas.
 *
 * A serverless function is not a server: the platform runs as many copies of
 * this module as it needs and disposes of them without warning. Connecting per
 * request would spend most of a request's budget on a TLS handshake and would
 * walk straight into the free tier's 500-connection ceiling, so the client is
 * held for as long as the instance lives and never closed by a handler.
 *
 * Two details matter and neither is obvious:
 *
 * Module scope is not durable enough. `next dev` re-evaluates a module on every
 * edit, and a build can end up with more than one copy of it. `globalThis`
 * survives both, so one process opens one pool however many times this file is
 * evaluated.
 *
 * What is cached is the *promise*, not the client. Two requests arriving on a
 * cold instance at the same moment must await the same `connect()`; caching the
 * resolved client instead leaves a window where both see nothing cached and
 * both dial out.
 */

const cache = globalThis as typeof globalThis & {
  __tidelineMongo?: Promise<MongoClient>;
};

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env.local and fill it in.');
  }

  return (cache.__tidelineMongo ??= new MongoClient(uri, {
    // Each instance keeps its own pool, so the number that matters upstream is
    // this times however many instances are warm. Ten is generous for four
    // small routes and leaves room under the free tier's limit.
    maxPoolSize: 10,
    // Nothing to keep warm: an idle instance is about to be disposed of.
    minPoolSize: 0,
    // Fail the request rather than hang it when the cluster cannot be reached.
    serverSelectionTimeoutMS: 5000,
  }).connect());
}

export async function getDb(): Promise<Db> {
  return (await connect()).db(process.env.MONGODB_DB ?? 'tideline');
}
