const ALLOWED_ORIGINS = new Set([
  "https://giswatidid.github.io",
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(origin, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (!ALLOWED_ORIGINS.has(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return json(origin, 405, { ok: false, error: "Method not allowed" });
    }

    if (!env.GITHUB_TOKEN) {
      return json(origin, 500, {
        ok: false,
        error: "GITHUB_TOKEN is not configured on the Worker.",
      });
    }

    const response = await fetch(
      "https://api.github.com/repos/giswatidid/Mapping/actions/workflows/generate-maps.yml/dispatches",
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "mapping-generate-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      return json(origin, 502, {
        ok: false,
        githubStatus: response.status,
        error: detail,
      });
    }

    return json(origin, 202, { ok: true, accepted: true });
  },
};
