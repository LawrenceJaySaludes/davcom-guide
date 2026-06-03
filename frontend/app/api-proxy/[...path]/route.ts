import { NextRequest } from "next/server";
import { getApiBaseCandidates, toApiUrl } from "../../../lib/api";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

let preferredApiBase: string | null = null;
const DEFAULT_PROXY_TIMEOUT_MS = 30000;

const getProxyTimeoutMs = () => {
  const raw = process.env.API_PROXY_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PROXY_TIMEOUT_MS;
  }

  return parsed;
};

const buildHeaders = (incoming: Headers) => {
  const headers = new Headers();

  for (const [key, value] of incoming.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  return headers;
};

async function proxy(request: NextRequest, path: string[]) {
  const bodyBytes =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : Buffer.from(await request.arrayBuffer());

  const normalizedPath = path[0] === "api" ? path.slice(1) : path;
  const apiPath = `/api/${normalizedPath.join("/")}${request.nextUrl.search}`;
  const headers = buildHeaders(request.headers);
  const candidates = getApiBaseCandidates();
  const orderedCandidates = preferredApiBase
    ? [preferredApiBase, ...candidates.filter((base) => base !== preferredApiBase)]
    : candidates;
  const errors: string[] = [];
  const timeoutMs = getProxyTimeoutMs();

  for (const base of orderedCandidates) {
    const target = toApiUrl(base, apiPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: bodyBytes ? Buffer.from(bodyBytes) : undefined,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      preferredApiBase = base;

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const details =
        message === "This operation was aborted"
          ? `${message} (timeout ${timeoutMs}ms)`
          : message;
      errors.push(`${target} -> ${details}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return Response.json(
    {
      message: "Unable to reach backend API from proxy.",
      details: errors,
    },
    { status: 502 }
  );
}

type Context = { params: Promise<{ path: string[] }> };

const getPath = async (context: Context) => {
  const params = await context.params;
  return params.path;
};

export async function GET(request: NextRequest, context: Context) {
  return proxy(request, await getPath(context));
}

export async function POST(request: NextRequest, context: Context) {
  return proxy(request, await getPath(context));
}

export async function PUT(request: NextRequest, context: Context) {
  return proxy(request, await getPath(context));
}

export async function PATCH(request: NextRequest, context: Context) {
  return proxy(request, await getPath(context));
}

export async function DELETE(request: NextRequest, context: Context) {
  return proxy(request, await getPath(context));
}

export async function OPTIONS(request: NextRequest, context: Context) {
  return proxy(request, await getPath(context));
}
