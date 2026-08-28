// Pure SPA: no server rendering, no prerender. The backend serves index.html
// for every path and the client router takes it from there.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
