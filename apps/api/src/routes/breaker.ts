import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { DrawdownBreaker } from '../dd-breaker';

/** Max-drawdown breaker status + config + manual resume. */
export function breakerRoutes(app: FastifyInstance, db: AppDB, breaker: DrawdownBreaker): void {
  app.get('/api/portfolio/breaker', async (req) => {
    getUser(req, db);
    return breaker.check();
  });

  const configSchema = z.object({
    enabled: z.boolean().optional(),
    limitPct: z.coerce.number().positive().max(100).optional(),
  });

  app.post('/api/portfolio/breaker', async (req, reply) => {
    getUser(req, db);
    const parsed = configSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_config' };
    }
    return breaker.configure(parsed.data);
  });

  app.post('/api/portfolio/breaker/resume', async (req) => {
    getUser(req, db);
    breaker.resume();
    return breaker.status();
  });
}
