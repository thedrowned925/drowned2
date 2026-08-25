const DEFAULT_OWNER = "thedrowned925";
const DEFAULT_REPO = "drowned2";
const MAX_RANGE_BYTES = 64 * 1024 * 1024;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://thedrowned925.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Drowned-Key",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function text(message, status, env, extra = {}) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...corsHeaders(env),
      ...extra,
    },
  });
}

function safeToken(value) {
  return /^[A-Za-z0-9._-]+$/.test(value || "");
}

function safeChunkAsset(value) {
  return /^chunk-\d{6}\.bin$/.test(value || "");
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== "GET") return text("Method not allowed", 405, env);

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return text("drowned2-range-proxy: ok", 200, env, { "Cache-Control": "no-store" });
    }
    if (url.pathname !== "/range") return text("Not found", 404, env);

    if (env.ACCESS_KEY) {
      const provided = request.headers.get("X-Drowned-Key") || "";
      if (!constantTimeEqual(provided, env.ACCESS_KEY)) return text("Unauthorized", 401, env);
    }

    const owner = url.searchParams.get("owner") || "";
    const repo = url.searchParams.get("repo") || "";
    const tag = url.searchParams.get("tag") || "";
    const asset = url.searchParams.get("asset") || "";
    const startRaw = url.searchParams.get("start");
    const endRaw = url.searchParams.get("end");

    const allowedOwner = env.ALLOWED_OWNER || DEFAULT_OWNER;
    const allowedRepo = env.ALLOWED_REPO || DEFAULT_REPO;
    if (owner !== allowedOwner || repo !== allowedRepo) return text("Repository not allowed", 403, env);
    if (!safeToken(tag)) return text("Invalid release tag", 400, env);
    if (!safeChunkAsset(asset)) return text("Invalid chunk asset", 400, env);

    const start = Number(startRaw);
    const end = Number(endRaw);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      return text("Invalid byte range", 400, env);
    }
    const length = end - start + 1;
    if (length > MAX_RANGE_BYTES) return text("Requested range is too large", 416, env);

    const assetUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
    let upstream;
    try {
      upstream = await fetch(assetUrl, {
        method: "GET",
        headers: {
          "Range": `bytes=${start}-${end}`,
          "Accept": "application/octet-stream",
          "User-Agent": "Drowned2-Range-Proxy/1.0",
        },
        redirect: "follow",
      });
    } catch (error) {
      return text(`GitHub fetch failed: ${error?.message || error}`, 502, env);
    }

    if (upstream.status !== 206) {
      const detail = await upstream.text().catch(() => "");
      return text(`GitHub did not honor Range (${upstream.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`, 502, env);
    }

    const contentRange = upstream.headers.get("Content-Range") || "";
    const expectedPrefix = `bytes ${start}-${end}/`;
    if (!contentRange.startsWith(expectedPrefix)) {
      return text(`Unexpected Content-Range: ${contentRange || "missing"}`, 502, env);
    }

    const upstreamLength = Number(upstream.headers.get("Content-Length") || 0);
    if (upstreamLength && upstreamLength !== length) {
      return text(`Unexpected Content-Length: ${upstreamLength}`, 502, env);
    }

    const headers = new Headers(corsHeaders(env));
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Cache-Control", "private, no-store");
    headers.set("Accept-Ranges", "bytes");
    for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(upstream.body, {
      status: 206,
      headers,
    });
  },
};
