const SERVER_FALLBACK_API_BASES = [
  "http://nginx",
  "http://host.docker.internal:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const CLIENT_FALLBACK_API_BASES = [
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const normalizeBase = (value: string) => value.replace(/\/+$/, "");

export const getApiBaseCandidates = () => {
  const fallbackBases =
    typeof window === "undefined" ? SERVER_FALLBACK_API_BASES : CLIENT_FALLBACK_API_BASES;

  const envBases = [
    process.env.API_BASE_URL,
    process.env.NEXT_PUBLIC_API_BASE_URL,
  ].filter((value): value is string => Boolean(value && value.trim()));

  return Array.from(
    new Set([...envBases, ...fallbackBases].map((base) => normalizeBase(base.trim())))
  );
};

export const toApiUrl = (base: string, path: string) =>
  `${normalizeBase(base)}${path.startsWith("/") ? path : `/${path}`}`;
