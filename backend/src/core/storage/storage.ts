import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../../config/env';
import { AppError } from '../security/errors';

export interface StoredFileMeta {
  storagePath: string;
  sizeBytes: number;
}

export interface PrivateStorageAdapter {
  readonly mode: 'supabase' | 'local_dev';
  buildTenantPath(organizationId: string, caseId: string, documentId: string, originalName: string): string;
  uploadPrivate(storagePath: string, buffer: Buffer, mimeType: string): Promise<StoredFileMeta>;
  downloadPrivate(storagePath: string): Promise<Buffer>;
  createSignedDownloadUrl(storagePath: string, expiresInSeconds?: number): Promise<{ url: string; expiresInSeconds: number }>;
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 100) || 'document.bin';
}

export class SupabasePrivateStorage implements PrivateStorageAdapter {
  public readonly mode = 'supabase' as const;
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(url: string, serviceRoleKey: string, bucket: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = bucket;
  }

  buildTenantPath(organizationId: string, caseId: string, documentId: string, originalName: string): string {
    return `org/${organizationId}/cases/${caseId}/${documentId}/${sanitizeFileName(originalName)}`;
  }

  async uploadPrivate(storagePath: string, buffer: Buffer, mimeType: string): Promise<StoredFileMeta> {
    const { error } = await this.client.storage.from(this.bucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) {
      throw new AppError(502, 'STORAGE_UPLOAD_FAILED', `Failed to upload private document: ${error.message}`);
    }
    return { storagePath, sizeBytes: buffer.length };
  }

  async downloadPrivate(storagePath: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(this.bucket).download(storagePath);
    if (error || !data) {
      throw new AppError(404, 'STORAGE_OBJECT_NOT_FOUND', 'Private document file could not be retrieved.');
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async createSignedDownloadUrl(storagePath: string, expiresInSeconds = 120): Promise<{ url: string; expiresInSeconds: number }> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new AppError(502, 'SIGNED_URL_FAILED', 'Could not create short-lived signed URL.');
    }
    return { url: data.signedUrl, expiresInSeconds };
  }
}

export class LocalDevPrivateStorage implements PrivateStorageAdapter {
  public readonly mode = 'local_dev' as const;
  private readonly rootDir: string;
  private readonly signingSecret: string;

  constructor(rootDir: string, signingSecret: string) {
    this.rootDir = path.resolve(rootDir);
    this.signingSecret = signingSecret;
  }

  buildTenantPath(organizationId: string, caseId: string, documentId: string, originalName: string): string {
    return `org/${organizationId}/cases/${caseId}/${documentId}/${sanitizeFileName(originalName)}`;
  }

  private resolveSafePath(storagePath: string): string {
    const target = path.resolve(this.rootDir, storagePath);
    if (!target.startsWith(this.rootDir)) {
      throw new AppError(400, 'INVALID_STORAGE_PATH', 'Attempted path traversal outside private storage.');
    }
    return target;
  }

  async uploadPrivate(storagePath: string, buffer: Buffer, _mimeType: string): Promise<StoredFileMeta> {
    const fullPath = this.resolveSafePath(storagePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return { storagePath, sizeBytes: buffer.length };
  }

  async downloadPrivate(storagePath: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(storagePath);
    try {
      return await fs.readFile(fullPath);
    } catch {
      throw new AppError(404, 'STORAGE_OBJECT_NOT_FOUND', 'Private document file not found in local dev storage.');
    }
  }

  async createSignedDownloadUrl(storagePath: string, expiresInSeconds = 120): Promise<{ url: string; expiresInSeconds: number }> {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${storagePath}:${exp}`)
      .digest('base64url');
    return {
      url: `/api/v1/documents/private-download?path=${encodeURIComponent(storagePath)}&exp=${exp}&sig=${sig}`,
      expiresInSeconds,
    };
  }

  verifySignedToken(storagePath: string, exp: number, sig: string): boolean {
    if (exp < Math.floor(Date.now() / 1000)) return false;
    const expected = crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${storagePath}:${exp}`)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

export function createPrivateStorage(env: AppEnv): PrivateStorageAdapter {
  if (env.DATA_STORE_MODE === 'supabase') {
    return new SupabasePrivateStorage(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.SUPABASE_STORAGE_BUCKET,
    );
  }
  const localRoot = path.resolve(process.cwd(), '.local-storage');
  return new LocalDevPrivateStorage(localRoot, env.DEV_AUTH_SECRET);
}
