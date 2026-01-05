import { Env } from '../types';

export function authenticate(request: Request, env: Env): Response | null {
    // Skip auth for OPTIONS (CORS)
    if (request.method === 'OPTIONS') {
        return null; // Let the main handler return CORS headers
    }

    // Skip auth for healthcheck
    const url = new URL(request.url);
    if (url.pathname === '/health') {
        return null;
    }

    const token = request.headers.get('X-Access-Token');
    const validToken = env.API_TOKEN;

    if (!token || token !== validToken) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Unauthorized'
        }), {
            status: 401,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // Ensure CORS works for 401 too
            }
        });
    }

    return null; // Auth success
}
