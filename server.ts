import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import {
  ALLOWED_SUFFIXES,
  MAX_UPLOAD_BYTES,
  PALETTE_PATH,
  ROOT,
  STORAGE_ROOT,
  ensureStorageDirs,
  safeStorageFile,
  uid,
} from './server/store.js';
import {
  DEFAULT_PARAMS,
  ENGINE_NAMES,
  PARAMETER_UI,
  loadPalette,
  runImageAndSave,
} from './server/mapping.js';
import { AUTO_PRESET_META, PRESETS, resolveProcessRequest, type ProcessRequestPayload } from './server/presets.js';
import { optimizeGrid } from './server/optimize.js';
import { assembleDualLayoutBooks, type BookArtworkInput } from './server/book.js';
import { attachLocalWorkspace, type WorkspaceRequest } from './src/middleware/workspace.js';
import {
  addAuditEvent,
  assignAssetsToProject,
  createAssetRecord,
  createBookRecord,
  createProcessingRun,
  createProjectForUser,
  deleteAssetsForUser,
  findDuplicateAssetBySha,
  getAssetForUser,
  getAssetSystem,
  getBookForUser,
  getBookSystem,
  getDashboardStats,
  getNextAssetVersion,
  getProjectForUser,
  getProjectOwnerUserId,
  getRunById,
  getRunsForAsset,
  listAssetsWithRuns,
  listAuditEventsForUser,
  listBooksForUser,
  listProjectsForUser,
  listRunsForUser,
  removeAssetsFromProject,
  resolveAssetOwnerUserId,
  serializeAssetRow,
  serializeBookRow,
  serializeProjectRow,
  updateAssetStatus,
  updateBookRecord,
  updateProcessingRun,
} from './src/db/queries.js';

ensureStorageDirs();

const app = express();
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES + 1024 },
});

function sendError(res: Response, status: number, detail: string) {
  res.status(status).json({ detail });
}

// --- Background job runners backed by Cloud SQL ---

async function executeProcessJob(assetId: string, runId: string): Promise<void> {
  try {
    const asset = await getAssetSystem(assetId);
    const run = await getRunById(runId);
    if (!asset || !run) return;

    await updateProcessingRun(runId, { state: 'running', startedAt: new Date() });
    await updateAssetStatus(assetId, 'processing');

    const outDir = path.join(STORAGE_ROOT, 'assets', asset.id, 'runs', run.id);
    fs.mkdirSync(outDir, { recursive: true });
    const runConfig = JSON.parse(run.paramsJson || '{}') as {
      params?: Record<string, unknown>;
      selected_engine?: string;
      allowed_engines?: string[];
      warnings?: string[];
      run_stability?: boolean;
      auto_grid?: boolean;
      effort?: number;
      explicit_params?: Record<string, unknown>;
      preset?: string | null;
      resolved_preset?: string | null;
      [k: string]: unknown;
    };
    fs.writeFileSync(path.join(outDir, 'mapping_config.json'), JSON.stringify(runConfig, null, 2), 'utf-8');

    // Optional: search for the fewest columns with the best fidelity per colouring effort.
    let gridOptimization: Awaited<ReturnType<typeof optimizeGrid>> | null = null;
    if (runConfig.auto_grid === true) {
      gridOptimization = await optimizeGrid(asset.storagePath, {
        effort: typeof runConfig.effort === 'number' ? runConfig.effort : undefined,
        overrides: {
          ...(runConfig.params?.bg_mode ? { bg_mode: runConfig.params.bg_mode } : {}),
          ...((runConfig.explicit_params as Record<string, unknown> | undefined) ?? {}),
        },
      });
      runConfig.params = gridOptimization.params as unknown as Record<string, unknown>;
      runConfig.selected_engine = gridOptimization.engine;
      runConfig.allowed_engines = undefined;
      fs.writeFileSync(path.join(outDir, 'grid_optimization.json'), JSON.stringify(gridOptimization, null, 2), 'utf-8');
    }

    const res = await runImageAndSave(
      asset.storagePath,
      outDir,
      runConfig.params,
      runConfig.selected_engine || 'D',
      Boolean(runConfig.run_stability),
      {
        allowedEngines: Array.isArray(runConfig.allowed_engines) ? runConfig.allowed_engines : undefined,
        warnings: Array.isArray(runConfig.warnings) ? runConfig.warnings : undefined,
      },
    );

    const updatedConfig = {
      ...runConfig,
      warnings: res.warnings,
      selected_engine_resolved: res.engine,
      auto_selection: res.autoSelection,
      ...(gridOptimization
        ? {
          params: gridOptimization.params,
          grid_optimization: {
            preset: gridOptimization.preset,
            engine: gridOptimization.engine,
            grid_cols: gridOptimization.grid_cols,
            rows: gridOptimization.rows,
            layout: gridOptimization.layout,
            effort: gridOptimization.effort,
            effort_options: gridOptimization.effort_options,
            reason: gridOptimization.reason,
            runtime_seconds: gridOptimization.runtime_seconds,
          },
        }
        : {}),
    };

    await updateProcessingRun(runId, {
      state: 'completed',
      outputDir: outDir,
      engine: res.engine,
      confidence: res.confidence,
      paramsJson: JSON.stringify(updatedConfig),
      finishedAt: new Date(),
    });
    await updateAssetStatus(assetId, 'review');

    const ownerUserId = await resolveAssetOwnerUserId(asset);
    if (ownerUserId !== null) {
      await addAuditEvent(
        uid(),
        ownerUserId,
        'asset',
        asset.id,
        'processed',
        `run=${run.id}; engine=${res.engine}; confidence=${res.confidence}; preset=${runConfig.preset || 'custom'}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await updateProcessingRun(runId, {
        state: 'failed',
        error: msg.slice(-8000),
        finishedAt: new Date(),
      });
      await updateAssetStatus(assetId, 'failed');
    } catch (updateErr) {
      console.error('Failed to persist processing failure state:', updateErr);
    }
  }
}

async function executeBookJob(bookId: string): Promise<void> {
  try {
    const book = await getBookSystem(bookId);
    if (!book) return;

    await updateBookRecord(bookId, { status: 'building' });
    const ids = JSON.parse(book.assetIdsJson) as string[];
    const arts: BookArtworkInput[] = [];

    for (const aid of ids) {
      const asset = await getAssetSystem(aid);
      if (!asset || asset.status !== 'approved' || asset.projectId !== book.projectId) {
        throw new Error(`Asset ${aid} is not approved for this project.`);
      }
      const runs = await getRunsForAsset(asset.id);
      const run = runs[0] ?? null;
      if (!run || run.state !== 'completed' || !run.outputDir) {
        throw new Error(`Asset ${aid} has no completed processing run.`);
      }
      const labelsJsonPath = path.join(run.outputDir, 'labels.json');
      if (!fs.existsSync(labelsJsonPath)) {
        throw new Error(`Labels missing for asset ${aid}.`);
      }
      const parsed = JSON.parse(fs.readFileSync(labelsJsonPath, 'utf-8')) as {
        rows: number;
        cols: number;
        data: number[];
      };
      arts.push({
        name: asset.logicalName,
        rows: parsed.rows,
        cols: parsed.cols,
        labels: Uint8Array.from(parsed.data),
      });
    }

    const palette = loadPalette(PALETTE_PATH);
    if (palette.length !== 21) {
      throw new Error('The frozen production palette must contain exactly 21 colours.');
    }

    const outDir = path.join(STORAGE_ROOT, 'projects', book.projectId, 'books', book.id);
    const result = await assembleDualLayoutBooks(
      outDir,
      book.title,
      book.subtitle,
      arts,
      palette,
      3.0,
      'CHROMABOOK',
    );
    if (!result.preflight.passed) {
      throw new Error('Both A4 layout outputs failed preflight; inspect the dual-layout report.');
    }

    await updateBookRecord(bookId, {
      // Existing download slots are reused for the two distinct A4 layout PDFs.
      bookPdfPath: result.side_by_side ? path.resolve(result.side_by_side) : null,
      answerKeyPath: result.full_page ? path.resolve(result.full_page) : null,
      reportPath: path.resolve(result.report),
      status: 'ready',
      error: null,
    });

    const ownerUserId = await getProjectOwnerUserId(book.projectId);
    if (ownerUserId !== null) {
      await addAuditEvent(uid(), ownerUserId, 'book', book.id, 'built', `assets=${arts.length}; side_by_side=${result.preflight.paired_count}; full_page=${result.preflight.single_page_count}; rejected=${result.preflight.rejected_count}; palette=21`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await updateBookRecord(bookId, {
        status: 'failed',
        error: msg.slice(-8000),
      });
    } catch (updateErr) {
      console.error('Failed to persist book failure state:', updateErr);
    }
  }
}

// --- Static & Health Routes ---

app.use(express.static(path.join(ROOT, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chromabook-studio', version: '0.8.0' });
});

// --- Local workspace API Routes (no sign-in required) ---

app.get('/api/dashboard', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const stats = await getDashboardStats(req.dbUser!.id);
    res.json({
      ...stats,
      palette: { id: 'main-21', colors: 21, locked: true },
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load dashboard.');
  }
});

app.get('/api/mapping/defaults', attachLocalWorkspace, (_req: WorkspaceRequest, res) => {
  res.json({
    schema: 'chromabook-advanced-mapping-v2',
    defaults: DEFAULT_PARAMS,
    controls: PARAMETER_UI,
    presets: PRESETS,
    auto_preset: AUTO_PRESET_META,
    engines: [
      { id: 'A', name: ENGINE_NAMES.A },
      { id: 'B', name: ENGINE_NAMES.B },
      { id: 'C', name: ENGINE_NAMES.C },
      { id: 'D', name: ENGINE_NAMES.D },
    ],
    palette: { id: 'main-21', colors: 21, editable: false },
  });
});

app.get('/api/system-status', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const palette = loadPalette(PALETTE_PATH);
    const stats = await getDashboardStats(req.dbUser!.id);
    res.json({
      service: 'ChromaBook Studio',
      version: '0.8.0',
      status: 'Operational',
      upload: {
        formats: ['PNG', 'JPG', 'JPEG', 'WEBP'],
        max_upload_mb: Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024)),
        independent_inbox_enabled: true,
      },
      palette: {
        id: 'main-21',
        count: palette.length,
        locked: true,
        colors: palette.map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
      },
      engines: Object.entries(ENGINE_NAMES).map(([id, name]) => ({ id, name, status: 'Ready' })),
      workspace: stats,
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load system status.');
  }
});

app.get('/api/projects', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const rows = await listProjectsForUser(req.dbUser!.id);
    res.json(rows);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load projects.');
  }
});

app.post('/api/projects', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const body = (req.body || {}) as { name?: unknown; description?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 160) {
      return sendError(res, 422, 'Project name must be between 1 and 160 characters.');
    }
    const description = typeof body.description === 'string' ? body.description.slice(0, 3000) : '';
    const project = await createProjectForUser(uid(), req.dbUser!.id, name, description);
    await addAuditEvent(uid(), req.dbUser!.id, 'project', project.id, 'created', project.name);
    res.status(201).json(serializeProjectRow(project, { assetCount: 0, approvedCount: 0 }));
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to create project.');
  }
});

app.post('/api/projects/:projectId/assign-assets', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const projectId = String(req.params.projectId);
    const project = await getProjectForUser(projectId, req.dbUser!.id);
    if (!project) return sendError(res, 404, 'Project not found.');

    const body = (req.body || {}) as { asset_ids?: unknown };
    const rawIds = Array.isArray(body.asset_ids) ? body.asset_ids : [];
    const assetIds = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter(Boolean)));
    if (assetIds.length === 0) {
      return sendError(res, 422, 'Select at least one artwork to assign.');
    }

    const found = await Promise.all(assetIds.map((id) => getAssetForUser(id, req.dbUser!.id)));
    if (found.some((x) => !x)) {
      return sendError(res, 404, 'One or more selected artworks could not be found.');
    }

    const updated = await assignAssetsToProject(project.id, req.dbUser!.id, assetIds);
    await addAuditEvent(
      uid(),
      req.dbUser!.id,
      'project',
      project.id,
      'assigned_assets',
      `project=${project.name}; count=${updated.length}; assets=${assetIds.join(',')}`,
    );

    res.json({
      project_id: project.id,
      project_name: project.name,
      assigned_count: updated.length,
      asset_ids: updated.map((a) => a.id),
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to assign artworks.');
  }
});

app.post('/api/projects/:projectId/remove-assets', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const projectId = String(req.params.projectId);
    const project = await getProjectForUser(projectId, req.dbUser!.id);
    if (!project) return sendError(res, 404, 'Project not found.');

    const body = (req.body || {}) as { asset_ids?: unknown };
    const rawIds = Array.isArray(body.asset_ids) ? body.asset_ids : [];
    const assetIds = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter(Boolean)));
    if (assetIds.length === 0) {
      return sendError(res, 422, 'Select at least one artwork to remove from this project.');
    }

    const updated = await removeAssetsFromProject(project.id, req.dbUser!.id, assetIds);
    if (updated.length === 0) {
      return sendError(res, 404, 'No matching artworks found in this project.');
    }

    await addAuditEvent(
      uid(),
      req.dbUser!.id,
      'project',
      project.id,
      'removed_assets',
      `project=${project.name}; count=${updated.length}; assets=${updated.map((a) => a.id).join(',')}`,
    );

    res.json({
      project_id: project.id,
      project_name: project.name,
      removed_count: updated.length,
      asset_ids: updated.map((a) => a.id),
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to remove artworks from project.');
  }
});

app.delete('/api/projects/:projectId/assets/:assetId', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const projectId = String(req.params.projectId);
    const assetId = String(req.params.assetId);
    const project = await getProjectForUser(projectId, req.dbUser!.id);
    if (!project) return sendError(res, 404, 'Project not found.');

    const updated = await removeAssetsFromProject(project.id, req.dbUser!.id, [assetId]);
    if (updated.length === 0) {
      return sendError(res, 404, 'Artwork not found in this project.');
    }

    await addAuditEvent(
      uid(),
      req.dbUser!.id,
      'project',
      project.id,
      'removed_asset',
      `project=${project.name}; asset=${assetId}`,
    );

    res.json({
      project_id: project.id,
      project_name: project.name,
      removed_count: 1,
      asset_id: assetId,
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to remove artwork from project.');
  }
});

async function storeUpload(
  projectId: string | null,
  userId: number,
  file: Express.Multer.File | undefined,
  rawLogicalName: string,
  parentAssetId: string | null = null,
) {
  if (projectId !== null) {
    const project = await getProjectForUser(projectId, userId);
    if (!project) {
      throw Object.assign(new Error('Project not found.'), { status: 404 });
    }
  }
  if (!file) {
    throw Object.assign(new Error('Empty upload.'), { status: 400 });
  }
  const suffix = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_SUFFIXES.has(suffix)) {
    throw Object.assign(new Error('Only PNG, JPG, JPEG and WEBP images are supported.'), { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw Object.assign(
      new Error(`Upload exceeds ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`),
      { status: 413 },
    );
  }
  if (!file.buffer || file.buffer.length === 0) {
    throw Object.assign(new Error('Empty upload.'), { status: 400 });
  }

  let imgWidth = 0;
  let imgHeight = 0;
  try {
    const meta = await sharp(file.buffer).metadata();
    if (!meta.width || !meta.height) {
      throw new Error('Invalid image dimensions');
    }
    imgWidth = meta.width;
    imgHeight = meta.height;
  } catch {
    throw Object.assign(new Error('The uploaded file is not a valid image.'), { status: 415 });
  }

  const baseName = (rawLogicalName || path.parse(file.originalname || 'artwork').name).trim();
  const logicalName =
    baseName.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 180).replace(/^[ .]+|[ .]+$/g, '') || 'artwork';

  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const duplicateMatch = await findDuplicateAssetBySha(userId, sha256);

  const version = await getNextAssetVersion(userId, projectId, logicalName);
  const aid = uid();
  // Store uploads under user/asset directory so project assignment never moves or duplicates files
  const destDir = path.join(STORAGE_ROOT, 'users', String(userId), 'assets', aid);
  fs.mkdirSync(destDir, { recursive: true });
  const filename = path
    .basename(file.originalname || `upload${suffix}`)
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 180);
  const dest = path.join(destDir, `source${suffix}`);
  fs.writeFileSync(dest, file.buffer);

  const asset = await createAssetRecord({
    id: aid,
    userId,
    projectId,
    logicalName,
    filename,
    storagePath: path.resolve(dest),
    sha256,
    width: imgWidth,
    height: imgHeight,
    fileSize: file.buffer.length,
    version,
    parentAssetId,
    status: 'uploaded',
  });
  await addAuditEvent(
    uid(),
    userId,
    'asset',
    aid,
    'uploaded',
    `name=${logicalName}; version=${version}; assigned=${projectId ? 'project' : 'inbox'}`,
  );
  return { asset, isDuplicate: Boolean(duplicateMatch) };
}

// Independent Artwork Inbox upload (no project required)
app.post('/api/assets/upload', attachLocalWorkspace, upload.single('file'), async (req: WorkspaceRequest, res) => {
  try {
    const logicalName = typeof req.body?.logical_name === 'string' ? req.body.logical_name : '';
    const { asset, isDuplicate } = await storeUpload(null, req.dbUser!.id, req.file, logicalName, null);
    res.status(201).json(serializeAssetRow(asset, [], { projectName: null, isDuplicate }));
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const msg = err instanceof Error ? err.message : 'Upload failed.';
    sendError(res, status, msg);
  }
});

// Direct project-scoped upload (preserved for backwards compatibility)
app.post('/api/projects/:projectId/assets', attachLocalWorkspace, upload.single('file'), async (req: WorkspaceRequest, res) => {
  try {
    const projectId = String(req.params.projectId);
    const project = await getProjectForUser(projectId, req.dbUser!.id);
    if (!project) return sendError(res, 404, 'Project not found.');
    const logicalName = typeof req.body?.logical_name === 'string' ? req.body.logical_name : '';
    const { asset, isDuplicate } = await storeUpload(projectId, req.dbUser!.id, req.file, logicalName, null);
    res.status(201).json(serializeAssetRow(asset, [], { projectName: project.name, isDuplicate }));
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const msg = err instanceof Error ? err.message : 'Upload failed.';
    sendError(res, status, msg);
  }
});

app.post('/api/assets/:assetId/revisions', attachLocalWorkspace, upload.single('file'), async (req: WorkspaceRequest, res) => {
  try {
    const found = await getAssetForUser(String(req.params.assetId), req.dbUser!.id);
    if (!found) return sendError(res, 404, 'Asset not found.');
    const { asset, isDuplicate } = await storeUpload(
      found.asset.projectId,
      req.dbUser!.id,
      req.file,
      found.asset.logicalName,
      found.asset.id,
    );
    res.status(201).json(serializeAssetRow(asset, [], { projectName: found.projectName, isDuplicate }));
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const msg = err instanceof Error ? err.message : 'Revision upload failed.';
    sendError(res, status, msg);
  }
});

app.get('/api/assets', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const projectId = typeof req.query.project_id === 'string' && req.query.project_id ? req.query.project_id : null;
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const list = await listAssetsWithRuns(req.dbUser!.id, { projectId, status });
    res.json(list);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load assets.');
  }
});

function isInsideStorageRoot(targetPath: string): boolean {
  const root = path.resolve(STORAGE_ROOT);
  const resolved = path.resolve(targetPath);
  return resolved.startsWith(`${root}${path.sep}`);
}

function cleanupDeletedAssetFiles(
  deletedAssets: Array<{ id: string; userId: number | null; storagePath: string }>,
  runOutputDirs: string[],
) {
  for (const dir of runOutputDirs) {
    if (isInsideStorageRoot(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const asset of deletedAssets) {
    const assetRunsRoot = path.join(STORAGE_ROOT, 'assets', asset.id);
    if (isInsideStorageRoot(assetRunsRoot)) {
      fs.rmSync(assetRunsRoot, { recursive: true, force: true });
    }
    if (asset.userId !== null) {
      const userAssetDir = path.join(STORAGE_ROOT, 'users', String(asset.userId), 'assets', asset.id);
      if (isInsideStorageRoot(userAssetDir)) {
        fs.rmSync(userAssetDir, { recursive: true, force: true });
      }
    }
    if (asset.storagePath && isInsideStorageRoot(asset.storagePath)) {
      fs.rmSync(asset.storagePath, { force: true });
    }
  }
}

app.post('/api/assets/delete', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const body = (req.body || {}) as { asset_ids?: unknown };
    const rawIds = Array.isArray(body.asset_ids) ? body.asset_ids : [];
    const assetIds = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter(Boolean)));
    if (assetIds.length === 0) {
      return sendError(res, 422, 'Select at least one artwork to delete.');
    }

    const found = await Promise.all(assetIds.map((id) => getAssetForUser(id, req.dbUser!.id)));
    const owned = found.filter((x): x is NonNullable<typeof x> => Boolean(x));
    if (owned.length === 0) {
      return sendError(res, 404, 'No matching artworks found.');
    }
    if (owned.some((x) => x.asset.status === 'processing')) {
      return sendError(res, 409, 'Cannot delete an artwork while processing is in progress.');
    }

    const { deletedAssets, runOutputDirs } = await deleteAssetsForUser(
      req.dbUser!.id,
      owned.map((x) => x.asset.id),
    );
    cleanupDeletedAssetFiles(deletedAssets, runOutputDirs);

    await addAuditEvent(
      uid(),
      req.dbUser!.id,
      'asset',
      deletedAssets[0]?.id || assetIds[0],
      'deleted',
      `count=${deletedAssets.length}; assets=${deletedAssets.map((a) => `${a.id}:${a.logicalName}`).join(',')}`,
    );

    res.json({
      deleted_count: deletedAssets.length,
      asset_ids: deletedAssets.map((a) => a.id),
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to delete artworks.');
  }
});

app.delete('/api/assets/:assetId', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const assetId = String(req.params.assetId);
    const found = await getAssetForUser(assetId, req.dbUser!.id);
    if (!found) return sendError(res, 404, 'Asset not found.');
    if (found.asset.status === 'processing') {
      return sendError(res, 409, 'Cannot delete an artwork while processing is in progress.');
    }

    const { deletedAssets, runOutputDirs } = await deleteAssetsForUser(req.dbUser!.id, [assetId]);
    cleanupDeletedAssetFiles(deletedAssets, runOutputDirs);

    await addAuditEvent(
      uid(),
      req.dbUser!.id,
      'asset',
      assetId,
      'deleted',
      `name=${found.asset.logicalName}; version=${found.asset.version}`,
    );

    res.json({
      deleted_count: deletedAssets.length,
      asset_id: assetId,
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to delete artwork.');
  }
});

app.get('/api/assets/:assetId/source', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const found = await getAssetForUser(String(req.params.assetId), req.dbUser!.id);
    if (!found) return sendError(res, 404, 'Asset not found.');
    const safePath = safeStorageFile(found.asset.storagePath);
    if (!safePath) return sendError(res, 404, 'Source image not found.');
    res.sendFile(safePath);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load source image.');
  }
});

app.post('/api/assets/:assetId/process', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const found = await getAssetForUser(String(req.params.assetId), req.dbUser!.id);
    if (!found) return sendError(res, 404, 'Asset not found.');
    const asset = found.asset;
    if (asset.status === 'processing') return sendError(res, 409, 'Asset is already processing.');

    const aspectHint = asset.width && asset.height && asset.height > 0 ? asset.width / asset.height : null;
    let resolved;
    try {
      resolved = await resolveProcessRequest(
        asset.storagePath,
        aspectHint,
        (req.body || {}) as ProcessRequestPayload,
      );
    } catch (err) {
      const status = (err as { status?: number }).status || 422;
      return sendError(res, status, err instanceof Error ? err.message : 'Invalid processing configuration.');
    }

    const run = await createProcessingRun({
      id: uid(),
      assetId: asset.id,
      state: 'queued',
      engine: resolved.selected_engine,
      paramsJson: JSON.stringify(resolved),
    });
    await updateAssetStatus(asset.id, 'processing');
    await addAuditEvent(
      uid(),
      req.dbUser!.id,
      'asset',
      asset.id,
      'processing_queued',
      `run=${run.id}; engine=${resolved.selected_engine}; preset=${resolved.preset || 'custom'}; schema=chromabook-advanced-mapping-v2`,
    );

    setImmediate(() => {
      void executeProcessJob(asset.id, run.id);
    });

    res.status(202).json({
      asset_id: asset.id,
      run_id: run.id,
      state: 'queued',
      preset: resolved.preset,
      resolved_preset: resolved.resolved_preset,
      target_layout: resolved.target_layout,
      selected_engine: resolved.selected_engine,
      params: resolved.params,
      run_stability: resolved.run_stability,
      auto_grid: resolved.auto_grid,
      effort: resolved.effort,
      analysis: resolved.analysis,
      warnings: resolved.warnings,
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to queue processing.');
  }
});

app.post('/api/assets/:assetId/review', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const found = await getAssetForUser(String(req.params.assetId), req.dbUser!.id);
    if (!found) return sendError(res, 404, 'Asset not found.');
    const asset = found.asset;
    const runs = await getRunsForAsset(asset.id);
    const latest = runs[0] ?? null;
    if (!latest || latest.state !== 'completed') {
      return sendError(res, 409, 'A completed processing run is required before review.');
    }
    const body = (req.body || {}) as { action?: string; note?: string };
    if (body.action !== 'approve' && body.action !== 'reject') {
      return sendError(res, 422, 'action must be approve or reject.');
    }
    const nextStatus = body.action === 'approve' ? 'approved' : 'rejected';
    await updateAssetStatus(asset.id, nextStatus);
    asset.status = nextStatus;
    const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : '';
    await addAuditEvent(uid(), req.dbUser!.id, 'asset', asset.id, body.action, note);
    res.json(serializeAssetRow(asset, runs, { projectName: found.projectName }));
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to save review.');
  }
});

const ALLOWED_PREVIEW_FILES = new Set([
  'color_preview.png',
  'numbered_preview.png',
  'mask.png',
  'asset_summary.json',
  'engine_comparison_metrics.json',
  'config.json',
  'render_preflight.json',
  'stability_metrics.json',
]);

function isAllowedPreviewName(filename: string): boolean {
  if (ALLOWED_PREVIEW_FILES.has(filename)) return true;
  return /^engine_[ABCD]\/(color_preview|numbered_preview|metrics)\.(png|json)$/.test(filename);
}

app.get(/^\/api\/assets\/([^/]+)\/runs\/([^/]+)\/preview\/(.+)$/, attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const assetId = req.params[0];
    const runId = req.params[1];
    const filename = req.params[2];
    if (!isAllowedPreviewName(filename)) return sendError(res, 404, 'Preview not found.');

    const found = await getAssetForUser(assetId, req.dbUser!.id);
    const run = await getRunById(runId);
    if (!found || !run || run.assetId !== found.asset.id || run.state !== 'completed' || !run.outputDir) {
      return sendError(res, 404, 'Processing run not found.');
    }
    const safePath = safeStorageFile(path.join(run.outputDir, filename));
    if (!safePath) return sendError(res, 404, 'File not found.');
    res.type(path.extname(safePath) === '.png' ? 'image/png' : 'application/json');
    res.sendFile(safePath);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to fetch preview.');
  }
});

app.get(/^\/api\/assets\/([^/]+)\/preview\/(.+)$/, attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const assetId = req.params[0];
    const filename = req.params[1];
    if (!isAllowedPreviewName(filename)) return sendError(res, 404, 'Preview not found.');

    const found = await getAssetForUser(assetId, req.dbUser!.id);
    if (!found) return sendError(res, 404, 'Asset not found.');
    const runs = await getRunsForAsset(found.asset.id);
    const run = runs[0] ?? null;
    if (!run || run.state !== 'completed' || !run.outputDir) {
      return sendError(res, 404, 'No completed preview.');
    }
    const safePath = safeStorageFile(path.join(run.outputDir, filename));
    if (!safePath) return sendError(res, 404, 'File not found.');
    const ext = path.extname(safePath);
    res.type(ext === '.png' ? 'image/png' : ext === '.md' ? 'text/markdown' : 'application/json');
    res.sendFile(safePath);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to fetch preview.');
  }
});

app.get('/api/runs', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit || '100'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 500)) : 100;
    const rows = await listRunsForUser(req.dbUser!.id, limit);
    res.json(rows);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load processing history.');
  }
});

app.post('/api/books', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const body = (req.body || {}) as {
      project_id?: string;
      asset_ids?: string[];
      title?: string;
      subtitle?: string;
    };
    const project =
      typeof body.project_id === 'string'
        ? await getProjectForUser(body.project_id, req.dbUser!.id)
        : null;
    if (!project) return sendError(res, 404, 'Project not found.');

    const assetIds = Array.isArray(body.asset_ids) ? body.asset_ids : [];
    if (assetIds.length === 0 || assetIds.length > 80) {
      return sendError(res, 422, 'Select between 1 and 80 approved assets.');
    }
    if (new Set(assetIds).size !== assetIds.length) {
      return sendError(res, 400, 'Duplicate asset IDs are not allowed.');
    }
    const selectedAssets = await Promise.all(assetIds.map((id) => getAssetForUser(id, req.dbUser!.id)));
    if (selectedAssets.some((found) => !found || found.asset.projectId !== project.id)) {
      return sendError(res, 400, 'All selected assets must belong to this project.');
    }
    if (selectedAssets.some((found) => found!.asset.status !== 'approved')) {
      return sendError(res, 409, 'Only approved assets can be assembled into a book.');
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 180) {
      return sendError(res, 422, 'Book title must be between 1 and 180 characters.');
    }
    const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim().slice(0, 300) : '';

    const book = await createBookRecord({
      id: uid(),
      projectId: project.id,
      title,
      subtitle,
      assetIdsJson: JSON.stringify(assetIds),
      status: 'queued',
    });
    await addAuditEvent(uid(), req.dbUser!.id, 'book', book.id, 'build_queued', `assets=${selectedAssets.length}`);

    setImmediate(() => {
      void executeBookJob(book.id);
    });

    res.status(202).json(serializeBookRow(book, project.name));
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to create book.');
  }
});

app.get('/api/books', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
    const rows = await listBooksForUser(req.dbUser!.id, projectId);
    res.json(rows);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load books.');
  }
});

app.get('/api/books/:bookId/download/:kind', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const book = await getBookForUser(String(req.params.bookId), req.dbUser!.id);
    if (!book) return sendError(res, 404, 'Book not found.');
    const kind = String(req.params.kind);
    const filePath =
      kind === 'book'
        ? book.bookPdfPath
        : kind === 'answer-key'
          ? book.answerKeyPath
          : kind === 'report'
            ? book.reportPath
            : null;
    if (!filePath) return sendError(res, 404, 'Requested artifact is not ready.');
    const safePath = safeStorageFile(filePath);
    if (!safePath) return sendError(res, 404, 'File not found.');
    res.download(safePath, path.basename(safePath));
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to download artifact.');
  }
});

app.get('/api/audit', attachLocalWorkspace, async (req: WorkspaceRequest, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit || '100'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 500)) : 100;
    const rows = await listAuditEventsForUser(req.dbUser!.id, limit);
    res.json(
      rows.map((r) => ({
        id: r.id,
        entity_type: r.entityType,
        entity_id: r.entityId,
        action: r.action,
        detail: r.detail,
        created_at: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to load audit log.');
  }
});

// Express error handler (including multer file size errors)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ detail: `Upload exceeds ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.` });
    return;
  }
  const msg = err instanceof Error ? err.message : 'Internal server error.';
  res.status(500).json({ detail: msg });
});

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`ChromaBook Studio listening on http://${HOST}:${PORT}`);
});
