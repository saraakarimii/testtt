import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  description: text('description').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const assets = pgTable(
  'assets',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 36 }).references(() => projects.id, {
      onDelete: 'set null',
    }),
    logicalName: varchar('logical_name', { length: 180 }).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    storagePath: text('storage_path').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    width: integer('width'),
    height: integer('height'),
    fileSize: integer('file_size'),
    version: integer('version').default(1).notNull(),
    parentAssetId: varchar('parent_asset_id', { length: 36 }),
    status: varchar('status', { length: 24 }).default('uploaded').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_assets_user_id').on(table.userId),
    index('ix_assets_project_id').on(table.projectId),
    index('ix_asset_project_name_version').on(table.projectId, table.logicalName, table.version),
  ],
);

export const processingRuns = pgTable(
  'processing_runs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    assetId: varchar('asset_id', { length: 36 })
      .references(() => assets.id, { onDelete: 'cascade' })
      .notNull(),
    state: varchar('state', { length: 24 }).default('queued').notNull(),
    outputDir: text('output_dir'),
    engine: varchar('engine', { length: 16 }),
    confidence: varchar('confidence', { length: 24 }),
    paramsJson: text('params_json').default('{}').notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('ix_processing_runs_asset_id').on(table.assetId)],
);

export const books = pgTable(
  'books',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    title: varchar('title', { length: 180 }).notNull(),
    subtitle: varchar('subtitle', { length: 300 }).default('').notNull(),
    assetIdsJson: text('asset_ids_json').notNull(),
    status: varchar('status', { length: 24 }).default('queued').notNull(),
    bookPdfPath: text('book_pdf_path'),
    answerKeyPath: text('answer_key_path'),
    reportPath: text('report_path'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('ix_books_project_id').on(table.projectId)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: varchar('entity_id', { length: 36 }).notNull(),
    action: varchar('action', { length: 80 }).notNull(),
    detail: text('detail').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('ix_audit_events_user_id').on(table.userId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  assets: many(assets),
  auditEvents: many(auditEvents),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.userId], references: [users.id] }),
  assets: many(assets),
  books: many(books),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  owner: one(users, { fields: [assets.userId], references: [users.id] }),
  project: one(projects, { fields: [assets.projectId], references: [projects.id] }),
  runs: many(processingRuns),
}));

export const processingRunsRelations = relations(processingRuns, ({ one }) => ({
  asset: one(assets, { fields: [processingRuns.assetId], references: [assets.id] }),
}));

export const booksRelations = relations(books, ({ one }) => ({
  project: one(projects, { fields: [books.projectId], references: [projects.id] }),
}));

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  user: one(users, { fields: [auditEvents.userId], references: [users.id] }),
}));
