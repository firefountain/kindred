const INSPECT = /\/api\/v1\/libraries\/([^/]+)\/books\/inspect(?:\?.*)?$/;
const COMMIT = /\/api\/v1\/libraries\/([^/]+)\/books(?:\?.*)?$/;

export function rewriteImportUrl(input, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const raw = typeof input === 'string' ? input : input?.url;
  if (!raw || method !== 'POST') return raw;

  const inspect = raw.match(INSPECT);
  if (inspect) return `/api/v2/import/libraries/${inspect[1]}/inspect`;

  const commit = raw.match(COMMIT);
  if (commit) return `/api/v2/import/libraries/${commit[1]}/commit`;

  return raw;
}

function enhanceBookInputs(root = document) {
  for (const input of root.querySelectorAll('input[type="file"][accept*=".epub"]')) {
    const accepted = new Set(String(input.accept || '').split(',').map(value => value.trim()).filter(Boolean));
    accepted.add('.zip');
    input.accept = [...accepted].join(',');
  }
}

export function installImportPipelineClient(target = window) {
  if (target.__kindredImportPipelineInstalled) return;
  target.__kindredImportPipelineInstalled = true;

  const originalFetch = target.fetch.bind(target);
  target.fetch = (input, init = {}) => {
    const rewritten = rewriteImportUrl(input, init);
    if (typeof input === 'string' && rewritten !== input) return originalFetch(rewritten, init);
    if (input instanceof Request && rewritten !== input.url) return originalFetch(new Request(rewritten, input), init);
    return originalFetch(input, init);
  };

  if (typeof document !== 'undefined') {
    enhanceBookInputs();
    const observer = new MutationObserver(() => enhanceBookInputs());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

if (typeof window !== 'undefined') installImportPipelineClient(window);
