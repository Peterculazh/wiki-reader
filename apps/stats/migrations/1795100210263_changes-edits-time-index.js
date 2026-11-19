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
  pgm.noTransaction();
  pgm.createIndex('changes', 'event_time', {
    name: 'changes_edits_time_idx',
    include: ['bot', 'length_old', 'length_new'],
    where: "type IN ('edit', 'new')",
    concurrently: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.noTransaction();
  pgm.dropIndex('changes', 'event_time', { name: 'changes_edits_time_idx' });
};
