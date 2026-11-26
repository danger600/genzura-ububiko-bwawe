// Exact origins and wildcard patterns (for example https://*.vercel.app) are both supported.
const normalizeOrigin = (value) => {
  const raw = String(value).trim().replace(/\/+$/, "");
  if (raw.includes("*")) return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
};

const defaultOrigins = [
  "https://genzura-ububiko-bwawe.vercel.app",
  // Vercel preview deployments use names like genzura-ububiko-bwawe-<hash>-<scope>.vercel.app.
  "https://genzura-ububiko-bwawe-*.vercel.app",
  "https://genzura-ububiko-bwawe.onrender.com",
  "https://ububikobwawe.netlify.app",
  "https://*--ububikobwawe.netlify.app",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  process.env.RENDER_EXTERNAL_URL || ""
].filter(Boolean);

// CLIENT_ORIGIN adds to the defaults so a stale deployment value cannot lock out the live app.
const allowedOrigins = [...new Set(
  [...defaultOrigins, ...(process.env.CLIENT_ORIGIN || "").split(",")]
    .map(normalizeOrigin)
    .filter(Boolean)
)];

const isOriginAllowed = (origin) => {
  if (!origin || allowedOrigins.includes("*")) return true;
  const normalized = normalizeOrigin(origin);
  return allowedOrigins.some((allowed) => {
    if (!allowed.includes("*")) return allowed === normalized;
    const pattern = allowed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern}$`, "i").test(normalized);
  });
};

// OAuth redirects are validated against the same list as browser CORS requests.
const isAllowedRedirect = (value) => {
  if (!value) return false;
  try {
    return isOriginAllowed(new URL(String(value)).origin);
  } catch {
    return false;
  }
};

export { normalizeOrigin, allowedOrigins, isOriginAllowed, isAllowedRedirect };
