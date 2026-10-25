// Database transactions for a request: inside inTransaction every query goes to that transaction's connection, so a
// change and the records that go with it (history, audit) are committed together or not at all.
import { AsyncLocalStorage } from 'node:async_hooks';

export function transactions(pool) {
  const current = new AsyncLocalStorage();
  return {
    /** The connection queries use now: the open transaction's, otherwise the pool. */
    db: () => current.getStore() ?? pool,
    /** Runs work in one transaction; a failure rolls everything back and is rethrown. */
    async inTransaction(work) {
      if (current.getStore()) return work();
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await current.run(client, work);
        await client.query('commit');
        return result;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally { client.release(); }
    },
  };
}

/** A stand-in for an Express response that keeps the status and body, so the reply can be sent after the commit. */
export function heldReply() {
  const reply = { status: 200, body: undefined };
  const res = { status(code) { reply.status = code; return res; }, json(body) { reply.body = body; return res; } };
  return { res, reply };
}
