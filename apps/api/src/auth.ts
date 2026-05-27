import type { FastifyRequest } from 'fastify';
import type { AppDB } from './db';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Dev auth — every request is the `demo` user. Phase 11 replaces this with Auth.js
 * (Credentials + OAuth) sharing the same session cookie name.
 */
export function getUser(_req: FastifyRequest, db: AppDB): SessionUser {
  const row = db.raw
    .prepare('SELECT id, email, display_name as displayName FROM users WHERE id = ?')
    .get('demo') as SessionUser | undefined;
  if (!row) {
    throw new Error('demo user missing — db migration failed');
  }
  return row;
}
