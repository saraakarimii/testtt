import fs from 'node:fs';
import path from 'node:path';
import { and, count, desc, eq, inArray, isNull, max, or } from 'drizzle-orm';
import { db } from './index.js';
import { assets, auditEvents, books, processingRuns, projects } from './schema.js';
import { maxColsForLayout } from '../../server/book.js';

export type ProjectRow = typeof projects.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type ProcessingRunRow = typeof processingRuns.$inferSelect;
export type BookRow = typeof books.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;

function readJsonSafe(filePath: string): unknown {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    return null;
  }
  return null;
}

export function serializeProjectRow(
  p: ProjectRow,
  stats?: { assetCount: number; approvedCount: number },
) {
  const assetCount = stats?.assetCount ?? 0;
  const approvedCount = stats?.approvedCount ?? 0;
  const status =
    approvedCount > 0 ? 'ready_for_book' : assetCount > 0 ? 'in_progress' : 'empty';
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    asset_count: assetCount,
    approved_count: approvedCount,
    status,
    created_at: p.createdAt.toISOString(),
  };
}

export function runPayloadFromRow(run: ProcessingRunRow, assetId: string) {
  const metrics = run.outputDir
    ? readJsonSafe(path.join(run.outputDir, 'engine_comparison_metrics.json'))
    : null;
  const stability = run.outputDir
    ? readJsonSafe(path.join(run.outputDir, 'stability_metrics.json'))
    : null;
  const summary = run.outputDir
    ? readJsonSafe(path.join(run.outputDir, 'asset_summary.json'))
    : null;
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(run.paramsJson || '{}');
  } catch {
    params = {};
  }

  const paramWarnings = Array.isArray(params.warnings)
    ? params.warnings.filter((w): w is string => typeof w === 'string' && w.length > 0)
    : [];
  const summaryWarnings =
    summary && typeof summary === 'object' && Array.isArray((summary as { warnings?: unknown }).warnings)
      ? ((summary as { warnings: unknown[] }).warnings).filter(
          (w): w is string => typeof w === 'string' && w.length > 0,
        )
      : [];
  const warnings = Array.from(new Set([...paramWarnings, ...summaryWarnings]));

  const hasMask = Boolean(
    run.state === 'completed' &&
      run.outputDir &&
      fs.existsSync(path.join(run.outputDir, 'mask.png')),
  );

  const autoSelection =
    (metrics && typeof metrics === 'object' && 'auto_selection' in metrics
      ? (metrics as Record<string, unknown>).auto_selection
      : null) ||
    params.auto_selection ||
    null;

  return {
    id: run.id,
    state: run.state,
    engine: run.engine,
    confidence: run.confidence,
    error: run.error,
    params,
    preset: typeof params.preset === 'string' ? params.preset : null,
    resolved_preset: typeof params.resolved_preset === 'string' ? params.resolved_preset : null,
    target_layout: typeof params.target_layout === 'string' ? params.target_layout : 'side_by_side',
    analysis: params.analysis || null,
    auto_selection: autoSelection,
    warnings,
    has_mask: hasMask,
    mask_url: hasMask ? `/api/assets/${assetId}/runs/${run.id}/preview/mask.png` : null,
    metrics,
    stability,
    preview_base_url:
      run.state === 'completed' ? `/api/assets/${assetId}/runs/${run.id}/preview/` : null,
    created_at: run.createdAt.toISOString(),
  };
}

export function serializeAssetRow(
  a: AssetRow,
  runs: ProcessingRunRow[],
  extra?: { projectName?: string | null; isDuplicate?: boolean },
) {
  const sortedRuns = [...runs].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  const latest = sortedRuns[0] ?? null;
  const aspectRatio = a.width && a.height && a.height > 0 ? a.width / a.height : 1;
  const sideBySideMaxCols = maxColsForLayout(aspectRatio, 'side_by_side', 21);
  const fullPageMaxCols = maxColsForLayout(aspectRatio, 'full_page', 21);

  return {
    id: a.id,
    project_id: a.projectId,
    project_name: extra?.projectName ?? null,
    assigned: a.projectId !== null,
    logical_name: a.logicalName,
    filename: a.filename,
    width: a.width ?? null,
    height: a.height ?? null,
    file_size: a.fileSize ?? null,
    side_by_side_max_cols: sideBySideMaxCols,
    full_page_max_cols: fullPageMaxCols,
    version: a.version,
    parent_asset_id: a.parentAssetId,
    status: a.status,
    sha256: a.sha256,
    is_duplicate: extra?.isDuplicate ?? false,
    created_at: a.createdAt.toISOString(),
    source_url: `/api/assets/${a.id}/source`,
    latest_run: latest ? runPayloadFromRow(latest, a.id) : null,
    run_history: sortedRuns.map((r) => runPayloadFromRow(r, a.id)),
    preview_url:
      latest && latest.state === 'completed' ? `/api/assets/${a.id}/preview/color_preview.png` : null,
  };
}

export function serializeBookRow(b: BookRow, projectName?: string | null) {
  return {
    id: b.id,
    project_id: b.projectId,
    project_name: projectName ?? null,
    title: b.title,
    subtitle: b.subtitle,
    status: b.status,
    error: b.error,
    created_at: b.createdAt.toISOString(),
    book_url: b.bookPdfPath ? `/api/books/${b.id}/download/book` : null,
    answer_key_url: b.answerKeyPath ? `/api/books/${b.id}/download/answer-key` : null,
    report_url: b.reportPath ? `/api/books/${b.id}/download/report` : null,
  };
}

export async function addAuditEvent(
  id: string,
  userId: number,
  entityType: string,
  entityId: string,
  action: string,
  detail = '',
) {
  try {
    await db.insert(auditEvents).values({
      id,
      userId,
      entityType,
      entityId,
      action,
      detail: detail.slice(0, 4000),
    });
  } catch (error) {
    console.error('Database audit insert failed:', error);
    throw new Error('Failed to record audit event.', { cause: error });
  }
}

export async function getDashboardStats(userId: number) {
  try {
    const [projCount] = await db
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.userId, userId));

    const userAssets = await db
      .select({
        id: assets.id,
        projectId: assets.projectId,
        status: assets.status,
      })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(or(eq(assets.userId, userId), eq(projects.userId, userId)));

    let unassigned = 0;
    let needsReview = 0;
    let approved = 0;
    for (const a of userAssets) {
      if (a.projectId === null) unassigned++;
      if (a.status === 'review') needsReview++;
      if (a.status === 'approved') approved++;
    }

    const [bookCount] = await db
      .select({ value: count() })
      .from(books)
      .innerJoin(projects, eq(books.projectId, projects.id))
      .where(eq(projects.userId, userId));

    return {
      projects: projCount?.value ?? 0,
      assets: userAssets.length,
      unassigned,
      needs_review: needsReview,
      approved,
      books: bookCount?.value ?? 0,
    };
  } catch (error) {
    console.error('Database dashboard query failed:', error);
    throw new Error('Failed to load dashboard statistics.', { cause: error });
  }
}

export async function listProjectsForUser(userId: number) {
  try {
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.createdAt));

    if (projectRows.length === 0) return [];

    const projectIds = projectRows.map((p) => p.id);
    const assetRows = await db
      .select({ projectId: assets.projectId, status: assets.status })
      .from(assets)
      .where(inArray(assets.projectId, projectIds));

    const statsMap = new Map<string, { assetCount: number; approvedCount: number }>();
    for (const row of assetRows) {
      if (!row.projectId) continue;
      const cur = statsMap.get(row.projectId) || { assetCount: 0, approvedCount: 0 };
      cur.assetCount++;
      if (row.status === 'approved') cur.approvedCount++;
      statsMap.set(row.projectId, cur);
    }

    return projectRows.map((p) => serializeProjectRow(p, statsMap.get(p.id)));
  } catch (error) {
    console.error('Database project list failed:', error);
    throw new Error('Failed to load projects.', { cause: error });
  }
}

export async function createProjectForUser(id: string, userId: number, name: string, description: string) {
  try {
    const [row] = await db
      .insert(projects)
      .values({ id, userId, name, description })
      .returning();
    return row;
  } catch (error) {
    console.error('Database project create failed:', error);
    throw new Error('Failed to create project.', { cause: error });
  }
}

export async function getProjectForUser(projectId: string, userId: number) {
  try {
    const [row] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    return row ?? null;
  } catch (error) {
    console.error('Database project fetch failed:', error);
    throw new Error('Failed to load project.', { cause: error });
  }
}

export async function getNextAssetVersion(
  userId: number,
  projectId: string | null,
  logicalName: string,
): Promise<number> {
  try {
    const cond = projectId
      ? and(eq(assets.projectId, projectId), eq(assets.logicalName, logicalName))
      : and(eq(assets.userId, userId), eq(assets.logicalName, logicalName));
    const [row] = await db.select({ maxVer: max(assets.version) }).from(assets).where(cond);
    return (row?.maxVer ?? 0) + 1;
  } catch (error) {
    console.error('Database version query failed:', error);
    throw new Error('Failed to compute asset version.', { cause: error });
  }
}

export async function findDuplicateAssetBySha(userId: number, sha256: string) {
  try {
    const [row] = await db
      .select({ asset: assets })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(and(or(eq(assets.userId, userId), eq(projects.userId, userId)), eq(assets.sha256, sha256)))
      .orderBy(assets.createdAt)
      .limit(1);
    return row?.asset ?? null;
  } catch (error) {
    console.error('Database duplicate check failed:', error);
    throw new Error('Failed to check duplicate artwork.', { cause: error });
  }
}

export async function createAssetRecord(values: typeof assets.$inferInsert) {
  try {
    const [row] = await db.insert(assets).values(values).returning();
    return row;
  } catch (error) {
    console.error('Database asset insert failed:', error);
    throw new Error('Failed to save uploaded asset.', { cause: error });
  }
}

export async function getAssetForUser(assetId: string, userId: number) {
  try {
    const [row] = await db
      .select({ asset: assets, projectName: projects.name })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(and(eq(assets.id, assetId), or(eq(assets.userId, userId), eq(projects.userId, userId))));
    return row ? { asset: row.asset, projectName: row.projectName ?? null } : null;
  } catch (error) {
    console.error('Database asset fetch failed:', error);
    throw new Error('Failed to load asset.', { cause: error });
  }
}

export async function getAssetSystem(assetId: string) {
  try {
    const [row] = await db.select().from(assets).where(eq(assets.id, assetId));
    return row ?? null;
  } catch (error) {
    console.error('Database asset system fetch failed:', error);
    throw new Error('Failed to load asset.', { cause: error });
  }
}

export async function resolveAssetOwnerUserId(asset: AssetRow): Promise<number | null> {
  if (asset.userId !== null) return asset.userId;
  if (!asset.projectId) return null;
  return getProjectOwnerUserId(asset.projectId);
}

export async function getProjectOwnerUserId(projectId: string): Promise<number | null> {
  try {
    const [row] = await db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId));
    return row?.userId ?? null;
  } catch (error) {
    console.error('Database project owner lookup failed:', error);
    throw new Error('Failed to resolve project owner.', { cause: error });
  }
}

export async function listAssetsWithRuns(
  userId: number,
  filters?: { projectId?: string | null; status?: string | null },
) {
  try {
    const ownershipCond = or(eq(assets.userId, userId), eq(projects.userId, userId));
    const conditions = [ownershipCond];

    if (filters?.status === 'unassigned') {
      conditions.push(isNull(assets.projectId));
    } else if (filters?.status) {
      conditions.push(eq(assets.status, filters.status));
    }

    if (filters?.projectId) {
      conditions.push(eq(assets.projectId, filters.projectId));
    }

    const rows = await db
      .select({ asset: assets, projectName: projects.name })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(assets.createdAt));

    if (rows.length === 0) return [];

    // Count SHA-256 occurrences across all user assets to flag duplicates cleanly
    const allUserShas = await db
      .select({ id: assets.id, sha256: assets.sha256, createdAt: assets.createdAt })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(ownershipCond);

    const earliestBySha = new Map<string, { id: string; time: number }>();
    for (const s of allUserShas) {
      const t = s.createdAt.getTime();
      const prev = earliestBySha.get(s.sha256);
      if (!prev || t < prev.time) {
        earliestBySha.set(s.sha256, { id: s.id, time: t });
      }
    }

    const assetIds = rows.map((r) => r.asset.id);
    const runRows = await db
      .select()
      .from(processingRuns)
      .where(inArray(processingRuns.assetId, assetIds))
      .orderBy(desc(processingRuns.createdAt));

    const runsByAsset = new Map<string, ProcessingRunRow[]>();
    for (const r of runRows) {
      const list = runsByAsset.get(r.assetId) || [];
      list.push(r);
      runsByAsset.set(r.assetId, list);
    }

    return rows.map((r) => {
      const first = earliestBySha.get(r.asset.sha256);
      const isDuplicate = Boolean(first && first.id !== r.asset.id);
      return serializeAssetRow(r.asset, runsByAsset.get(r.asset.id) || [], {
        projectName: r.projectName ?? null,
        isDuplicate,
      });
    });
  } catch (error) {
    console.error('Database asset list failed:', error);
    throw new Error('Failed to load artwork library.', { cause: error });
  }
}

export async function assignAssetsToProject(projectId: string, userId: number, assetIds: string[]) {
  try {
    const updated = await db
      .update(assets)
      .set({ projectId, userId })
      .where(and(inArray(assets.id, assetIds), eq(assets.userId, userId)))
      .returning();

    // Handle any legacy records owned via project join where userId was null
    if (updated.length < assetIds.length) {
      const remaining = assetIds.filter((id) => !updated.some((u) => u.id === id));
      for (const aid of remaining) {
        const found = await getAssetForUser(aid, userId);
        if (found) {
          const [row] = await db
            .update(assets)
            .set({ projectId, userId })
            .where(eq(assets.id, aid))
            .returning();
          if (row) updated.push(row);
        }
      }
    }
    return updated;
  } catch (error) {
    console.error('Database assign assets failed:', error);
    throw new Error('Failed to assign artworks to project.', { cause: error });
  }
}

export async function removeAssetsFromProject(projectId: string, userId: number, assetIds: string[]) {
  try {
    const updated: AssetRow[] = [];
    for (const aid of assetIds) {
      const found = await getAssetForUser(aid, userId);
      if (found && found.asset.projectId === projectId) {
        const [row] = await db
          .update(assets)
          .set({ projectId: null, userId })
          .where(eq(assets.id, aid))
          .returning();
        if (row) updated.push(row);
      }
    }
    return updated;
  } catch (error) {
    console.error('Database remove assets from project failed:', error);
    throw new Error('Failed to remove artworks from project.', { cause: error });
  }
}

export async function deleteAssetsForUser(userId: number, assetIds: string[]) {
  try {
    const owned: AssetRow[] = [];
    for (const aid of assetIds) {
      const found = await getAssetForUser(aid, userId);
      if (found) owned.push(found.asset);
    }
    if (owned.length === 0) {
      return { deletedAssets: [] as AssetRow[], runOutputDirs: [] as string[] };
    }

    const ownedIds = owned.map((a) => a.id);
    const runRows = await db
      .select({ outputDir: processingRuns.outputDir })
      .from(processingRuns)
      .where(inArray(processingRuns.assetId, ownedIds));
    const runOutputDirs = runRows
      .map((r) => r.outputDir)
      .filter((d): d is string => typeof d === 'string' && d.length > 0);

    await db
      .update(assets)
      .set({ parentAssetId: null })
      .where(inArray(assets.parentAssetId, ownedIds));

    await db.delete(assets).where(inArray(assets.id, ownedIds));

    return { deletedAssets: owned, runOutputDirs };
  } catch (error) {
    console.error('Database delete assets failed:', error);
    throw new Error('Failed to delete artworks.', { cause: error });
  }
}

export async function getRunsForAsset(assetId: string) {
  try {
    return await db
      .select()
      .from(processingRuns)
      .where(eq(processingRuns.assetId, assetId))
      .orderBy(desc(processingRuns.createdAt));
  } catch (error) {
    console.error('Database runs fetch failed:', error);
    throw new Error('Failed to load processing runs.', { cause: error });
  }
}

export async function listRunsForUser(userId: number, limit = 100) {
  try {
    const rows = await db
      .select({
        run: processingRuns,
        assetName: assets.logicalName,
        assetVersion: assets.version,
        projectName: projects.name,
      })
      .from(processingRuns)
      .innerJoin(assets, eq(processingRuns.assetId, assets.id))
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(or(eq(assets.userId, userId), eq(projects.userId, userId)))
      .orderBy(desc(processingRuns.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      ...runPayloadFromRow(r.run, r.run.assetId),
      asset_id: r.run.assetId,
      asset_name: r.assetName,
      asset_version: r.assetVersion,
      project_name: r.projectName ?? null,
    }));
  } catch (error) {
    console.error('Database user runs list failed:', error);
    throw new Error('Failed to load processing history.', { cause: error });
  }
}

export async function getRunById(runId: string) {
  try {
    const [row] = await db.select().from(processingRuns).where(eq(processingRuns.id, runId));
    return row ?? null;
  } catch (error) {
    console.error('Database run fetch failed:', error);
    throw new Error('Failed to load processing run.', { cause: error });
  }
}

export async function createProcessingRun(values: typeof processingRuns.$inferInsert) {
  try {
    const [row] = await db.insert(processingRuns).values(values).returning();
    return row;
  } catch (error) {
    console.error('Database run create failed:', error);
    throw new Error('Failed to queue processing run.', { cause: error });
  }
}

export async function updateProcessingRun(
  runId: string,
  patch: Partial<typeof processingRuns.$inferInsert>,
) {
  try {
    await db.update(processingRuns).set(patch).where(eq(processingRuns.id, runId));
  } catch (error) {
    console.error('Database run update failed:', error);
    throw new Error('Failed to update processing run.', { cause: error });
  }
}

export async function updateAssetStatus(assetId: string, status: string) {
  try {
    await db.update(assets).set({ status }).where(eq(assets.id, assetId));
  } catch (error) {
    console.error('Database asset status update failed:', error);
    throw new Error('Failed to update asset status.', { cause: error });
  }
}

export async function createBookRecord(values: typeof books.$inferInsert) {
  try {
    const [row] = await db.insert(books).values(values).returning();
    return row;
  } catch (error) {
    console.error('Database book insert failed:', error);
    throw new Error('Failed to create book.', { cause: error });
  }
}

export async function getBookSystem(bookId: string) {
  try {
    const [row] = await db.select().from(books).where(eq(books.id, bookId));
    return row ?? null;
  } catch (error) {
    console.error('Database book fetch failed:', error);
    throw new Error('Failed to load book.', { cause: error });
  }
}

export async function getBookForUser(bookId: string, userId: number) {
  try {
    const [row] = await db
      .select({ book: books })
      .from(books)
      .innerJoin(projects, eq(books.projectId, projects.id))
      .where(and(eq(books.id, bookId), eq(projects.userId, userId)));
    return row?.book ?? null;
  } catch (error) {
    console.error('Database book fetch failed:', error);
    throw new Error('Failed to load book.', { cause: error });
  }
}

export async function updateBookRecord(bookId: string, patch: Partial<typeof books.$inferInsert>) {
  try {
    await db.update(books).set(patch).where(eq(books.id, bookId));
  } catch (error) {
    console.error('Database book update failed:', error);
    throw new Error('Failed to update book.', { cause: error });
  }
}

export async function listBooksForUser(userId: number, projectId: string | null) {
  try {
    const cond = projectId
      ? and(eq(projects.userId, userId), eq(books.projectId, projectId))
      : eq(projects.userId, userId);

    const rows = await db
      .select({ book: books, projectName: projects.name })
      .from(books)
      .innerJoin(projects, eq(books.projectId, projects.id))
      .where(cond)
      .orderBy(desc(books.createdAt));

    return rows.map((r) => serializeBookRow(r.book, r.projectName));
  } catch (error) {
    console.error('Database book list failed:', error);
    throw new Error('Failed to load books.', { cause: error });
  }
}

export async function listAuditEventsForUser(userId: number, limit: number) {
  try {
    return await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, userId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
  } catch (error) {
    console.error('Database audit list failed:', error);
    throw new Error('Failed to load audit log.', { cause: error });
  }
}
