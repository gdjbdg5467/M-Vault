import { apiError, apiSuccess } from '../../../utils/api-v1.js';
import { buildS3ClientFromConfig } from '../../../utils/r2-registry.js';

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
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

  const endpoint = String(body.endpoint || '').trim().replace(/\/+$/, '');
  const bucket = String(body.bucket || '').trim();
  const accessKeyId = String(body.accessKeyId || '').trim();
  const secretAccessKey = String(body.secretAccessKey || '').trim();
  const region = String(body.region || 'auto').trim() || 'auto';

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return apiError('VALIDATION_ERROR', 'Endpoint、桶名、Access Key、Secret 均不能为空。', 400);
  }

  try {
    const client = buildS3ClientFromConfig({ endpoint, bucket, accessKeyId, secretAccessKey, region });
    const ok = await client.checkConnection();
    if (!ok) {
      return apiError('R2_CONNECTION_FAILED', '连接失败：无法访问该 R2 桶（请检查凭证与 Endpoint）。', 400);
    }
    return apiSuccess({ connected: true, bucket, endpoint });
  } catch (error) {
    return apiError('R2_CONNECTION_FAILED', error?.message || '连接失败。', 400);
  }
}
