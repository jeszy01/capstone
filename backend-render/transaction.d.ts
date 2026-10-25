// Types for transaction.js, which the frontend tests import.
type Queryable = { query: (sql: string | { text: string }) => Promise<unknown> };
type Pool = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };
export function transactions(pool: Pool): { db: () => Queryable; inTransaction: <T>(work: () => Promise<T>) => Promise<T> };
export function heldReply(): { res: { status: (code: number) => unknown; json: (body: unknown) => unknown }; reply: { status: number; body: unknown } };
