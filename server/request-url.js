// `path` is reserved Vercel rewrite metadata, never an analytical filter.
// Keep the actual pathname and every other query value subject to normal API
// validation. Route metadata must not choose or change the requested endpoint.
export function withoutRoutingQuery(value) {
  const url = new URL(value, 'http://dashboard.internal');
  if (!url.searchParams.has('path')) return value;
  url.searchParams.delete('path');
  return url.pathname + url.search;
}
