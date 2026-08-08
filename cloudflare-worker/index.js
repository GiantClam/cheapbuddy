const UPSTREAM_BASE = 'https://sub2api-production-493f.up.railway.app';
const PUBLIC_API_ADMIN_PREFIX = '/api/v1/admin';

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  if (origin === 'https://cheapbuddy.cc' || origin === 'https://www.cheapbuddy.cc') {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }

    if (url.pathname === PUBLIC_API_ADMIN_PREFIX || url.pathname.startsWith(`${PUBLIC_API_ADMIN_PREFIX}/`)) {
      return withCors(new Response(JSON.stringify({ message: '管理接口仅对私有管理域名开放' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }), request);
    }

    const upstreamUrl = new URL(`${url.pathname}${url.search}`, UPSTREAM_BASE);
    const upstreamRequest = new Request(upstreamUrl, request);
    const response = await fetch(upstreamRequest);
    return withCors(response, request);
  },
};
