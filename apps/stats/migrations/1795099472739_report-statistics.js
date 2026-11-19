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
    `CREATE STATISTICS changes_day_stats ON (date_trunc('day', event_time, 'UTC')) FROM changes`,
  );
  pgm.sql(
    `CREATE STATISTICS changes_hour_stats ON (date_trunc('hour', event_time, 'UTC')) FROM changes`,
  );
  pgm.sql('ANALYZE changes');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql('DROP STATISTICS changes_day_stats, changes_hour_stats');
};
