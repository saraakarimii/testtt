import 'dotenv/config';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, createPool } from './index.js';

// Applies SQL migrations from ./drizzle (relative to the working directory).
const folder = path.resolve(process.cwd(), 'drizzle');
await migrate(db, { migrationsFolder: folder });
console.log(`Migrations applied from ${folder}`);
await createPool().end();
