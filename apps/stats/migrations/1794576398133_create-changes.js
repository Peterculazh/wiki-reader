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
  pgm.sql(
    `CREATE TABLE changes (
    event_id UUID PRIMARY KEY,
    event_time TIMESTAMPTZ NOT NULL,
    wiki text NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    author text NOT NULL,
    namespace int NOT NULL,
    bot boolean NOT NULL,
    length_old int,
    length_new int,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
        `,
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {};
