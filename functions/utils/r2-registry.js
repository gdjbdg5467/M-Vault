/**
 * R2 多桶注册表
 *
 * 支持多个账号 / 多个 R2 桶。配置持久化在 KV (img_url) 中。
 * 每个注册表桶配置: { id, name, endpoint, region, bucket, accessKeyId, secretAccessKey, enabled, isDefault, createdAt }
 *
 * 特殊虚拟桶 "__bound__": 使用 Pages 绑定的 env.R2_BUCKET（仅覆盖一个桶），
 * 作为默认项始终可用（若绑定了 R2_BUCKET）。
 *
 * 跨账号桶（非绑定桶）通过 S3Client 直连各账号 endpoint 访问。
 */
import { S3Client } from './s3client.js';

export const R2_BUCKETS_KEY = 'r2_buckets_registry';
export const BOUND_BUCKET_ID = '__bound__';
const KV_CANDIDATES = ['img_url', 'KV', 'UI_CONFIG_KV', 'R2_BUCKETS_KV'];

export function resolveR2Kv(env = {}) {
  for (const name of KV_CANDIDATES) {
    const candidate = env?.[name];
    if (candidate && typeof candidate.get === 'function' && typeof candidate.put === 'function') {
      return { name, binding: candidate };
    }
  }
  return null;
}

/** 读取注册表桶列表 */
export async function getR2Buckets(env) {
  const kv = resolveR2Kv(env);
  if (!kv) return [];
  try {
    const raw = await kv.binding.get(R2_BUCKETS_KEY, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** 写回注册表桶列表 */
export async function saveR2Buckets(env, list) {
  const kv = resolveR2Kv(env);
  if (!kv) throw new Error('未找到可用的 KV 绑定，无法保存 R2 桶注册表。');
  await kv.binding.put(R2_BUCKETS_KEY, JSON.stringify(list));
}

/** 组装完整桶列表（绑定桶虚拟项 + 注册表桶） */
export async function listAllR2Buckets(env) {
  const registry = await getR2Buckets(env);
  const items = [];
  if (env.R2_BUCKET) {
    items.push({
      id: BOUND_BUCKET_ID,
      name: '默认 R2 桶（绑定）',
      endpoint: '',
      region: 'auto',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      enabled: true,
      isDefault: true,
      isBound: true,
      createdAt: 0,
    });
  }
  for (const b of registry) {
    items.push({ ...b, isBound: false });
  }
  return items;
}

/** 返回给客户端的列表（隐藏密钥） */
export function maskR2Buckets(items) {
  return items.map((b) => ({
    id: b.id,
    name: b.name,
    endpoint: b.endpoint,
    region: b.region || 'auto',
    bucket: b.bucket,
    enabled: b.enabled !== false,
    isDefault: !!b.isDefault,
    isBound: !!b.isBound,
    hasSecret: !!b.secretAccessKey,
    createdAt: b.createdAt || 0,
  }));
}

/** 是否存在任何可用的 R2 桶 */
export async function hasAvailableR2(env) {
  if (env.R2_BUCKET) return true;
  const registry = await getR2Buckets(env);
  return registry.some((b) => b.enabled !== false);
}

/**
 * 解析选中的桶。
 * @returns { null | { type:'bound', id:'__bound__', config:null } | { type:'s3', id, config } }
 * 优先级: 显式 selector -> 绑定桶 -> 第一个启用的注册表桶
 */
export async function resolveR2Bucket(env, selector) {
  const all = await listAllR2Buckets(env);

  if (selector && selector !== BOUND_BUCKET_ID) {
    const found = all.find((b) => b.id === selector && !b.isBound);
    if (found) {
      return { type: 's3', id: found.id, config: found };
    }
  }

  if (env.R2_BUCKET) {
    return { type: 'bound', id: BOUND_BUCKET_ID, config: null };
  }

  const fallback = all.find((b) => b.enabled !== false);
  if (fallback) {
    return { type: 's3', id: fallback.id, config: fallback };
  }
  return null;
}

/** 由注册表桶配置构建 S3 客户端 */
export function buildS3ClientFromConfig(cfg) {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region || 'auto',
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  });
}

export function normalizeBucketInput(input = {}) {
  const name = String(input.name || '').trim();
  const endpoint = String(input.endpoint || '').trim().replace(/\/+$/, '');
  const bucket = String(input.bucket || '').trim();
  const accessKeyId = String(input.accessKeyId || '').trim();
  const secretAccessKey = String(input.secretAccessKey || '').trim();
  const region = String(input.region || 'auto').trim() || 'auto';
  const enabled = input.enabled !== false;
  const isDefault = !!input.isDefault;
  return { name, endpoint, region, bucket, accessKeyId, secretAccessKey, enabled, isDefault };
}

export function validateBucketInput(input) {
  if (!input.name) return '缺少桶名称';
  if (!input.endpoint) return '缺少 Endpoint（例如 https://<account_id>.r2.cloudflarestorage.com）';
  if (!input.bucket) return '缺少 R2 桶名';
  if (!input.accessKeyId) return '缺少 Access Key ID';
  if (!input.secretAccessKey) return '缺少 Secret Access Key';
  return null;
}

export function generateBucketId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return 'r2b_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
