import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

// Handle all HTTP methods
export async function action({ request }: ActionFunctionArgs) {
  return handleProxyRequest(request);
}

export async function loader({ request }: LoaderFunctionArgs) {
  return handleProxyRequest(request);
}

async function handleProxyRequest(request: Request) {
  try {
    // Get the target URL from the query parameter
    const url = new URL(request.url);
    const targetURL = url.searchParams.get('url');

    if (!targetURL) {
      return json({ error: 'Target URL is required' }, { status: 400 });
    }

    // Forward the request to the target URL
    const response = await fetch(targetURL, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),

        // Override host header with the target host
        host: new URL(targetURL).host,
      },
      body: ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer(),
    });

    // Create response with CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
    }

    // Forward the response with CORS headers
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Git proxy error:', error);
    return json({ error: 'Proxy error' }, { status: 500 });
  }
}
