/**
 * Cloudflare Worker — 通用代理 + Docker Registry Mirror
 *
 * 路由规则：
 *   OPTIONS *                  → CORS 预检
 *   /v2/...                    → Docker Registry → registry-1.docker.io
 *   /https://... /http://...   → 通用 URL 代理（git clone / wget）
 *   /<image> 或 /<user>/<img>  → Docker pull（docker pull 本域名时）
 *   其他路径                     → Pages 静态资源
 */

// ============================================================
// 配置
// ============================================================

const DOCKER_UPSTREAM = 'https://registry-1.docker.io';

const ALLOWED_HOSTS = [
  'github.com', 'api.github.com', 'raw.githubusercontent.com',
  'gist.github.com', 'gist.githubusercontent.com',
  'quay.io', 'gcr.io', 'k8s.gcr.io', 'registry.k8s.io',
  'ghcr.io', 'docker.cloudsmith.io', 'registry-1.docker.io',
  // Docker 认证服务器：改写 401 挑战的 realm 后，客户端 token 请求也走本代理
  'auth.docker.io', 'production.cloudflare.docker.com',
];

const DOCKER_REGISTRIES = new Set([
  'quay.io', 'gcr.io', 'k8s.gcr.io', 'registry.k8s.io',
  'ghcr.io', 'docker.cloudsmith.io', 'registry-1.docker.io',
]);

const STRIP_REQ_HEADERS = new Set([
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
  'cf-ew-via', 'x-forwarded-proto', 'x-real-ip', 'cdn-loop',
]);

const STRIP_RES_HEADERS = new Set([
  'content-security-policy', 'content-security-policy-report-only',
  'x-content-security-policy', 'x-webkit-csp',
]);

// 空 body 的 SHA-256，S3 需要
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MAX_REDIRECTS = 5;

// ============================================================
// 工具函数
// ============================================================

function isAmazonS3(url) {
  try { return new URL(url).hostname.includes('amazonaws.com'); } catch { return false; }
}

function getAmzDate() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z';
}

/** 构建代理请求头：去掉 CF 私有头，替换 Host，S3 自动补 amz 头 */
function buildReqHeaders(request, targetUrl) {
  const targetHost = new URL(targetUrl).host;
  const h = new Headers();

  for (const [k, v] of request.headers) {
    if (STRIP_REQ_HEADERS.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === 'host') { h.set('host', targetHost); continue; }
    h.set(k, v);
  }
  if (!h.has('host')) h.set('host', targetHost);

  // S3 需要这四个头，客户端可能不带
  if (isAmazonS3(targetUrl)) {
    h.set('x-amz-content-sha256', EMPTY_BODY_SHA256);
    h.set('x-amz-date', getAmzDate());
  } else {
    // 非 S3 去掉可能干扰的残留 amz 头
    h.delete('x-amz-content-sha256');
    h.delete('x-amz-date');
    h.delete('x-amz-security-token');
    h.delete('x-amz-user-agent');
  }
  return h;
}

/** CORS 预检 */
function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/** 包装上游响应：加 CORS + 去敏感头 */
function wrapResponse(upstream) {
  const h = new Headers(upstream.headers);
  for (const name of STRIP_RES_HEADERS) h.delete(name);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  h.set('Access-Control-Allow-Headers', '*');
  h.set('Access-Control-Expose-Headers', '*');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: h,
  });
}

// ============================================================
// 边缘缓存策略（通过响应 Cache-Control 让 Cloudflare 边缘缓存）
// ============================================================

/**
 * 根据上游 URL 判断可缓存性，返回 Cache-Control 值；不可缓存返回 null。
 * 仅对 2xx GET 响应设置。注意：
 * - 只改 Cache-Control，不改内容类型等；
 * - 重定向链最终取到字节的那一跳会命中其真实 URL 的判断
 *   （Docker blob 经 S3 302 后路径里仍含 /blobs/sha256:）。
 */
function cacheControlFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname;
  const path = u.pathname;

  // Docker blob：sha256 寻址、内容不可变 → 强缓存 7 天
  if (/\/blobs\/sha256:[0-9a-f]{64}$/.test(path) || /\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\/data$/.test(path)) {
    return 'public, max-age=604800, immutable';
  }
  // GitHub raw / gist 原始文件 → 1 小时
  if (host === 'raw.githubusercontent.com' || host === 'gist.githubusercontent.com') {
    return 'public, max-age=3600';
  }
  // GitHub archive（tar/zip）与 release 附件、codeload → 1 小时
  if (host === 'codeload.github.com' || /\/releases\/download\//.test(path) || /\/archive\/.+\.(tar\.gz|tgz|zip)$/.test(path)) {
    return 'public, max-age=3600';
  }
  return null;
}

/** 包装响应；若该 URL 内容可缓存且返回 2xx，则加上边缘缓存头 */
function withCache(resp, url) {
  const wrapped = wrapResponse(resp);
  if (resp.status >= 200 && resp.status < 300) {
    const cc = cacheControlFor(url);
    if (cc) wrapped.headers.set('Cache-Control', cc);
  }
  return wrapped;
}

/**
 * Worker 层缓存：对不可变内容用 caches.default 直接命中，
 * 不依赖控制台 Cache Rules（命中后完全不再回源）。
 * 仅缓存 GET、无 Range 头、且 cacheControlFor 判定可缓存的 URL。
 */
async function serveCached(request, ctx, targetUrl, isDocker) {
  const cc = cacheControlFor(targetUrl);
  const useCache = !!cc && request.method === 'GET' && !request.headers.has('Range');
  if (!useCache) return proxyWithAuth(targetUrl, request, isDocker);

  const cache = caches.default;
  // 缓存键只按 URL（内容按 sha256/tag 寻址，与请求头无关）
  const key = new Request(request.url, { method: 'GET' });

  const hit = await cache.match(key);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('X-CF-Worker-Cache', 'HIT');
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h });
  }

  const resp = await proxyWithAuth(targetUrl, request, isDocker);
  if (resp.status === 200) {
    const forCache = resp.clone();
    forCache.headers.set('X-CF-Worker-Cache', 'HIT'); // 存入副本带标记，便于观测命中
    ctx.waitUntil(cache.put(key, forCache));
    resp.headers.set('X-CF-Worker-Cache', 'MISS');
  }
  return resp;
}

// ============================================================
// 防滥用
// ============================================================

/** 常见扫描器/爬虫 UA（不拦截 curl/wget/git/docker 等正常客户端） */
const BLOCKED_UAS = /(?:zgrab|masscan|nuclei|sqlmap|netcraft|nmap|censys|scanner|paloaltonetworks|netdatasysteme)/i;

/** 拦截枚举类接口，防止被索引/刷量 */
function isBlockedPath(pathname) {
  return pathname === '/v2/_catalog' || /^\/https?:\/\/[^/]+\/v2\/_catalog/i.test(pathname);
}

// ============================================================
// Docker Auth Token
// ============================================================

/** 解析 WWW-Authenticate 并拿 token（各属性独立解析，不依赖顺序） */
async function fetchDockerToken(wwwAuth, request) {
  const realm = wwwAuth.match(/realm="([^"]+)"/)?.[1];
  if (!realm) return null;
  const service = wwwAuth.match(/service="([^"]*)"/)?.[1] || 'registry.docker.io';
  const scope = wwwAuth.match(/scope="([^"]*)"/)?.[1] || '';

  const tokenUrl = new URL(realm);
  tokenUrl.searchParams.set('service', service);
  if (scope) tokenUrl.searchParams.set('scope', scope);

  // 透传客户端 Basic 凭据（docker login 本域名后），让用户用自己的 Docker Hub 配额
  const headers = { Accept: 'application/json' };
  const auth = request?.headers.get('Authorization');
  if (auth && /^Basic /i.test(auth)) headers.Authorization = auth;

  try {
    const res = await fetch(tokenUrl.href, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || data.access_token || null;
  } catch {
    return null;
  }
}

/**
 * 把 401 挑战里的 realm 改写为本代理域名（/https://<auth主机><路径>），
 * 否则客户端会直连 auth.docker.io 等认证服务器——国内直连会超时。
 */
function rewriteAuthChallenge(resp, request) {
  const www = resp.headers.get('WWW-Authenticate');
  if (!www) return resp;
  let rewritten;
  try {
    const origin = new URL(request.url).origin;
    rewritten = www.replace(/realm="([^"]+)"/, (_, realm) => {
      const u = new URL(realm);
      return `realm="${origin}/https://${u.host}${u.pathname}"`;
    });
  } catch {
    return resp;
  }
  const h = new Headers(resp.headers);
  h.set('WWW-Authenticate', rewritten);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

// ============================================================
// 核心代理（带 token 重试 + S3 重定向反代）
// ============================================================

async function proxyWithAuth(targetUrl, request, isDocker, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    return new Response('Too many redirects', { status: 508 });
  }

  const headers = buildReqHeaders(request, targetUrl);

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual', // 关键：手动处理重定向
  });

  // ===== Docker 401 → 拿 token 重试 =====
  if (isDocker && upstream.status === 401) {
    const wwwAuth = upstream.headers.get('WWW-Authenticate');
    if (wwwAuth) {
      const token = await fetchDockerToken(wwwAuth, request);
      if (token) {
        const authHeaders = buildReqHeaders(request, targetUrl);
        authHeaders.set('Authorization', `Bearer ${token}`);
        const retry = await fetch(targetUrl, {
          method: request.method,
          headers: authHeaders,
          body: request.body,
          redirect: 'manual',
        });
        // 重试仍 401：改写挑战 realm 走本代理，避免客户端直连认证服务器
        if (retry.status === 401) return rewriteAuthChallenge(wrapResponse(retry), request);
        return retry;
      }
    }
    // token 拿不到：返回 401，但把 realm 改写为走本代理
    return rewriteAuthChallenge(wrapResponse(upstream), request);
  }

  // ===== S3 / CDN / GitHub 重定向 → 重新代理（含 301/308，git clone 常见）=====
  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get('Location');
    if (location) {
      const redirUrl = new URL(location, targetUrl).href;
      const redirHeaders = buildReqHeaders(request, redirUrl);
      // 带回上游给的 Authorization（如果有的话）
      const upstreamAuth = upstream.headers.get('Authorization');
      if (upstreamAuth) redirHeaders.set('Authorization', upstreamAuth);

      const redirResp = await fetch(redirUrl, {
        method: request.method,
        headers: redirHeaders,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
        redirect: 'manual',
      });

      // 如果还是重定向，递归
      if ([301, 302, 303, 307, 308].includes(redirResp.status)) {
        const nextLocation = redirResp.headers.get('Location');
        if (nextLocation) {
          return proxyWithAuth(new URL(nextLocation, redirUrl).href, request, isDocker, redirectCount + 1);
        }
      }
      return withCache(redirResp, redirUrl);
    }
  }

  return withCache(upstream, targetUrl);
}

// ============================================================
// Docker 路径解析
// ============================================================

/**
 * 仅识别两种 Docker 路径（Docker daemon 实际发出的请求格式）：
 *   /v2/library/nginx/...         → Docker Hub registry mirror
 *   /ghcr.io/user/image/...       → 第三方 registry
 * 不做"单段 = library/xxx"的猜测，避免把 /gh、/docs 等静态页面路径误判为镜像名。
 */
function parseDockerPath(pathname, search) {
  if (pathname.startsWith('/v2/')) {
    return {
      targetUrl: DOCKER_UPSTREAM + pathname + (search || ''),
      isDocker: true,
    };
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  if (DOCKER_REGISTRIES.has(parts[0])) {
    const host = parts[0];
    const imagePath = parts.slice(1).join('/');
    return {
      targetUrl: `https://${host}/v2/${imagePath}`,
      isDocker: true,
    };
  }

  return null;
}

// ============================================================
// 主入口
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, search } = url;

    if (request.method === 'OPTIONS') return corsPreflight();

    // —— 防滥用：扫描器 UA 与枚举接口 ——
    if (BLOCKED_UAS.test(request.headers.get('User-Agent') || '')) {
      return new Response('Forbidden\n', { status: 403 });
    }
    if (isBlockedPath(pathname)) {
      return new Response('Forbidden\n', { status: 403 });
    }

    // —— Docker 路径 ——
    const docker = parseDockerPath(pathname, search);
    if (docker) {
      return serveCached(request, ctx, docker.targetUrl, docker.isDocker);
    }

    // —— 通用 URL 代理 (/https://github.com/...) ——
    // 注意：Cloudflare 边缘会对 URL 做规范化，把路径里的 "//" 折叠成 "/"，
    // Worker 实际可能收到 /https:/github.com/...，这里用 \/+ 同时兼容两种形态
    const protoMatch = pathname.match(/^\/(https?):\/+(.+)$/i);
    if (protoMatch) {
      const targetUrl = `${protoMatch[1].toLowerCase()}://${protoMatch[2]}${search || ''}`;
      // 目标域名不在白名单里就拒绝
      try {
        const targetHost = new URL(targetUrl).hostname;
        if (!ALLOWED_HOSTS.includes(targetHost)) {
          return new Response(`Error: domain "${targetHost}" not allowed.\n`, { status: 400 });
        }
      } catch {
        return new Response('Error: invalid target URL.\n', { status: 400 });
      }
      return serveCached(request, ctx, targetUrl, false);
    }

    // —— 静态资源 ——
    try {
      const assetsResp = await env.ASSETS.fetch(request);
      // 如果路径不含扩展名，且 ASSETS 返回了 404，尝试追加 .html
      if (assetsResp.status === 404 && !pathname.includes('.')) {
        const htmlUrl = new URL(request.url);
        htmlUrl.pathname = pathname + '.html';
        const htmlResp = await env.ASSETS.fetch(new Request(htmlUrl, request));
        if (htmlResp.status !== 404) return htmlResp;
      }
      return assetsResp;
    } catch (_) {
      return new Response('Not Found', { status: 404 });
    }
  },
};
