/**
 * CloudBase configuration — resolved at runtime, never hard-coded.
 *
 * The env id is read from a build-time public env var. Secrets (SecretId /
 * SecretKey / private keys) must NOT live in the browser bundle; they belong to
 * server-side code or CloudBase's official auth, not here.
 */

export interface CloudBaseConfig {
  envId: string;
}

function readEnvId(): string | undefined {
  // Next.js / vinext public env convention.
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID;
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

let cached: CloudBaseConfig | null | undefined;

export function getCloudBaseConfig(): CloudBaseConfig | null {
  if (cached !== undefined) return cached;
  const envId = readEnvId();
  cached = envId ? { envId } : null;
  return cached;
}

export function isCloudBaseConfigured(): boolean {
  return getCloudBaseConfig() !== null;
}
