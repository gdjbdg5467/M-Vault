import { apiError, apiSuccess } from '../utils/api-v1.js';
import { listAllR2Buckets, maskR2Buckets, hasAvailableR2 } from '../utils/r2-registry.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'GET') {
    return apiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  const all = await listAllR2Buckets(env);
  return apiSuccess({
    available: await hasAvailableR2(env),
    boundAvailable: !!env.R2_BUCKET,
    buckets: maskR2Buckets(all),
  });
}
