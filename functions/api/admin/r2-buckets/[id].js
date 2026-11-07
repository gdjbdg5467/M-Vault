import { apiError, apiSuccess } from '../../../utils/api-v1.js';
import {
  getR2Buckets,
  saveR2Buckets,
  maskR2Buckets,
  buildS3ClientFromConfig,
} from '../../../utils/r2-registry.js';
import { writeAuditLog, AUDIT_EVENTS } from '../../../utils/audit.js';

function clientTag(request) {
  const ua = String(request.headers.get('User-Agent') || '').slice(0, 60);
  return ua || 'unknown';
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params?.id;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (!id) {
    return apiError('VALIDATION_ERROR', '缺少桶 ID。', 400);
  }

  const list = await getR2Buckets(env);
  const index = list.findIndex((b) => b.id === id);
  if (index === -1) {
    return apiError('NOT_FOUND', 'R2 桶不存在。', 404);
  }

  if (request.method === 'GET') {
    return apiSuccess({ bucket: maskR2Buckets([list[index]])[0] });
  }

  if (request.method === 'DELETE') {
    const [removed] = list.splice(index, 1);
    await saveR2Buckets(env, list);

    await writeAuditLog(env, {
      event: AUDIT_EVENTS.R2_BUCKET_DELETED,
      tokenId: id,
      operation: 'admin.r2-buckets.delete',
      success: true,
      client: clientTag(request),
      detail: `name="${removed.name}" bucket="${removed.bucket}"`,
    });

    return apiSuccess({ deleted: true, id });
  }

  if (request.method === 'PUT') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const current = list[index];
    const name = String(body.name || '').trim() || current.name;
    const endpoint = String(body.endpoint || '').trim().replace(/\/+$/, '') || current.endpoint;
    const bucket = String(body.bucket || '').trim() || current.bucket;
    const accessKeyId = String(body.accessKeyId || '').trim() || current.accessKeyId;
    const secretAccessKey = body.secretAccessKey ? String(body.secretAccessKey).trim() : current.secretAccessKey;
    const region = String(body.region || '').trim() || current.region || 'auto';

    if (!name || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      return apiError('VALIDATION_ERROR', '桶名称、Endpoint、桶名、Access Key、Secret 均不能为空。', 400);
    }

    const updated = {
      ...current,
      name,
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      enabled: body.enabled !== undefined ? body.enabled !== false : current.enabled !== false,
      isDefault: body.isDefault !== undefined ? !!body.isDefault : !!current.isDefault,
    };
    list[index] = updated;
    await saveR2Buckets(env, list);

    await writeAuditLog(env, {
      event: AUDIT_EVENTS.R2_BUCKET_UPDATED,
      tokenId: id,
      operation: 'admin.r2-buckets.update',
      success: true,
      client: clientTag(request),
      detail: `name="${name}" bucket="${bucket}"`,
    });

    return apiSuccess({ bucket: maskR2Buckets([updated])[0] });
  }

  return apiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
}
