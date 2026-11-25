/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE digests (
      id bigserial PRIMARY KEY,
      generated_at timestamptz NOT NULL,
      hours int NOT NULL,
      wikis text[] NOT NULL,
      data_until timestamptz,
      skipped_pages int NOT NULL,
      cost_usd numeric(10, 6) NOT NULL,
      items jsonb NOT NULL
    )
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql('DROP TABLE digests');
};
