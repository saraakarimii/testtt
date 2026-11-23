import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidateRoot = path.resolve(__dirname, '..');
export const ROOT = fs.existsSync(path.join(candidateRoot, 'data', 'main-21.palette.json'))
  ? candidateRoot
  : path.resolve(__dirname, '..', '..');
export const DATA_ROOT = path.resolve(process.env.CHROMABOOK_DATA_DIR || path.join(ROOT, 'var'));
export const STORAGE_ROOT = path.join(DATA_ROOT, 'storage');
export const PALETTE_PATH = path.join(ROOT, 'data', 'main-21.palette.json');
export const MAX_UPLOAD_BYTES = (Number.parseInt(process.env.MAX_UPLOAD_MB || '25', 10) || 25) * 1024 * 1024;
export const ALLOWED_SUFFIXES = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function uid(): string {
  return crypto.randomUUID();
}

export function ensureStorageDirs(): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}

export function safeStorageFile(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const rel = path.relative(STORAGE_ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}
