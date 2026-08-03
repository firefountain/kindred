export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = Number(options.status) || 0;
    this.code = options.code || '';
    this.payload = options.payload ?? null;
    this.cause = options.cause;
  }
}

function apiBaseUrl() {
  return String(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

function requestUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl()}${normalizedPath}`;
}

async function parseResponse(response) {
  const contentType = response.headers?.get?.('content-type') || '';

  if (response.status === 204) return null;

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (cause) {
      throw new ApiError('The Kindred API returned invalid JSON.', {
        status: response.status,
        code: 'INVALID_JSON_RESPONSE',
        cause,
      });
    }
  }

  return response.text();
}

export async function apiRequest(path, options = {}) {
  const transport = options.fetch || globalThis.fetch;

  if (typeof transport !== 'function') {
    throw new ApiError('No fetch implementation is available.', {
      code: 'FETCH_UNAVAILABLE',
    });
  }

  const headers = new Headers(options.headers || {});
  let body = options.body;

  if (body != null && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  try {
    const response = await transport(requestUrl(path), {
      ...options,
      fetch: undefined,
      headers,
      body,
    });

    const payload = await parseResponse(response);

    if (!response.ok) {
      throw new ApiError(
        payload?.error || payload?.message || `Request failed with status ${response.status}.`,
        {
          status: response.status,
          code: payload?.code || 'API_REQUEST_FAILED',
          payload,
        },
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    throw new ApiError(error.message || 'Unable to reach the Kindred API.', {
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }
}
