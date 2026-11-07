import { apiError, apiSuccess } from '../../utils/api-v1.js';
import {
  getR2Buckets,
  saveR2Buckets,
  listAllR2Buckets,
  maskR2Buckets,
  normalizeBucketInput,
  validateBucketInput,
  generateBucketId,
} from '../../utils/r2-registry.js';
import { writeAuditLog, AUDIT_EVENTS } from '../../utils/audit.js';

function clientTag(request) {
  const ua = String(request.headers.get('User-Agent') || '').slice(0, 60);
  return ua || 'unknown';
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method === 'GET') {
    const all = await listAllR2Buckets(env);
    return apiSuccess({ buckets: maskR2Buckets(all), boundAvailable: !!env.R2_BUCKET });
  }

  if (request.method !== 'POST') {
    return apiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const input = normalizeBucketInput(body);
  const invalid = validateBucketInput(input);
  if (invalid) {
    return apiError('VALIDATION_ERROR', invalid, 400);
  }

  try {
    const list = await getR2Buckets(env);
    const id = generateBucketId();
    const record = {
      id,
      name: input.name,
      endpoint: input.endpoint,
      region: input.region,
      bucket: input.bucket,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      enabled: input.enabled,
      isDefault: input.isDefault,
      createdAt: Date.now(),
    };
    list.push(record);
    await saveR2Buckets(env, list);

    await writeAuditLog(env, {
      event: AUDIT_EVENTS.R2_BUCKET_CREATED,
      tokenId: id,
      operation: 'admin.r2-buckets.create',
      success: true,
      client: clientTag(request),
      detail: `name="${input.name}" bucket="${input.bucket}" endpoint="${input.endpoint}"`,
    });

    return apiSuccess({ bucket: maskR2Buckets([record])[0] }, 201);
  } catch (error) {
    return apiError('R2_BUCKET_CREATE_FAILED', error?.message || '创建 R2 桶失败。', 400);
  }
}
