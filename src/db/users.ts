import { db } from './index.js';
import { users } from './schema.js';
import { asc } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}


/**
 * Returns the existing primary owner for a no-login, single-user workspace.
 * Reusing the oldest existing account keeps previously uploaded assets and books visible.
 */
export async function getOrCreateLocalWorkspaceUser() {
  const existing = await db.select().from(users).orderBy(asc(users.id)).limit(1);
  if (existing[0]) return existing[0];
  return getOrCreateUser('chromabook-local-workspace', 'local@chromabook.local');
}
