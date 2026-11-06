import {
  buildConfig,
  handleFileRequest as cftcHandleFileRequest,
  initDatabase as cftcInitDatabase,
} from './utils/cftc-core.js';

/**
 * Catch-all 直链路由（cftc 格式：https://domain/{path}）
 * - path 为 cftc 的 R2 key / fileId / fileName
 * - 非 cftc 路径放行到静态资源（context.next()）
 */
export async function onRequestGet(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\//, '');

  // 只处理看起来像 cftc 直链的路径（含文件扩展名，非 API/静态资源）
  // 非文件路径直接放行
  if (!path || path.includes('/') || !path.includes('.')) {
    return next ? next() : new Response('Not Found', { status: 404 });
  }

  const cftcConfig = buildConfig(env, request);
  if (!cftcConfig.tgBotToken && !cftcConfig.bucket && !cftcConfig.database) {
    return next ? next() : new Response('Not Found', { status: 404 });
  }

  try {
    await cftcInitDatabase(cftcConfig);
  } catch (dbError) {
    // DB 未初始化时如果 R2 能直接命中就返回，否则放行
    if (cftcConfig.bucket) {
      try {
        const object = await cftcConfig.bucket.get(path);
        if (object) {
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('Content-Type', object.httpMetadata.contentType || 'application/octet-stream');
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Cache-Control', 'public, max-age=31536000');
          return new Response(object.body, { headers });
        }
      } catch (r2Err) {
        // 继续
      }
    }
    return next ? next() : new Response('Not Found', { status: 404 });
  }

  const response = await cftcHandleFileRequest(request, cftcConfig);
  // 404 时放行（可能是 K-Vault 自有路径被 catch-all 兜底）
  if (response.status === 404 && next) {
    return next();
  }
  return response;
}
