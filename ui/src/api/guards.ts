// Narrow type guards for network JSON: every backend response passes through these.
// Constraint: never cast unknown network data to a type; read fields only through these helpers.

export type Json = Record<string, unknown>;

export const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (o: Json, key: string): string | undefined => {
  const v = o[key];
  return typeof v === 'string' ? v : undefined;
};

export const num = (o: Json, key: string): number | undefined => {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

export const bool = (o: Json, key: string): boolean | undefined => {
  const v = o[key];
  return typeof v === 'boolean' ? v : undefined;
};

export const rec = (o: Json, key: string): Json | undefined => {
  const v = o[key];
  return isRecord(v) ? v : undefined;
};

export const strings = (o: Json, key: string): string[] | undefined => {
  const v = o[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
};

export const records = (o: Json, key: string): Json[] => {
  const v = o[key];
  return Array.isArray(v) ? v.filter(isRecord) : [];
};

/** http(s) URL or a host-relative path ("/api/..."): the only image sources we render. */
export const safeImageUrl = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2000) return undefined;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  return isHttpUrl(v) ? v : undefined;
};

export const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host !== '';
  } catch {
    return false;
  }
};
