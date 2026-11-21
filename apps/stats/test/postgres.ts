import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';

export async function startTestDatabase() {
  const container = await new PostgreSqlContainer('postgres:17').start();
  const databaseUrl = container.getConnectionUri();

  await runner({
    databaseUrl,
    dir: 'apps/stats/migrations',
    migrationsTable: 'pgmigrations',
    direction: 'up',
    count: Infinity,
    log: () => {},
  });

  const pool = new Pool({ connectionString: databaseUrl });

  return {
    pool,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
