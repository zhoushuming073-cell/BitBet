/**
 * Minimal ambient types for bare `tsc --noEmit` / editor typecheck.
 *
 * The real `cloudflare:workers` module and the Fetcher / D1Database globals are
 * provided by the Cloudflare Workers runtime and vinext/wrangler at build time.
 * This shim exists only so standalone TypeScript checking is green; it carries
 * no runtime code and is ignored by the bundler. D1 is disabled in this project.
 */
declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const env: any;
}

declare type Fetcher = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

declare type D1Database = unknown;
