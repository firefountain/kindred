export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status || 0;
    this.payload = options.payload;
  }
}

export function createApiClient(options = {}) {
  const baseUrl = String(options.baseUrl || '/api/v1').replace(/\/$/, '');
  const transport = options.fetch || globalThis.fetch;

  async function request(path, requestOptions = {}) {
    const response = await transport(`${baseUrl}${path}`, requestOptions);
    const contentType = response.headers?.get?.('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      throw new ApiError(
        payload?.error || payload?.message || `Request failed with status ${response.status}`,
        { status: response.status, payload },
      );
    }

    return payload;
  }

  return {
    request,
    libraries: {
      list: () => request('/libraries'),
      get: id => request(`/libraries/${encodeURIComponent(id)}`),
      open: id => request(`/libraries/${encodeURIComponent(id)}/open`, { method: 'POST' }),
      items: id => request(`/libraries/${encodeURIComponent(id)}/items`),
      updateItem: (libraryId, itemId, patch) =>
        request(`/libraries/${encodeURIComponent(libraryId)}/items/${encodeURIComponent(itemId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }),
    },
    devices: {
      scanKindle: () => request('/devices/kindle/scan', { method: 'POST' }),
    },
    metadata: {
      search: query => request('/metadata/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      }),
      enrichItem: (libraryId, itemId) =>
        request(`/libraries/${encodeURIComponent(libraryId)}/items/${encodeURIComponent(itemId)}/enrich`, {
          method: 'POST',
        }),
    },
  };
}

export const api = createApiClient();
