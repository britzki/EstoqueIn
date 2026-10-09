import { readLocal, removeLocal, writeLocal } from './storage';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'estoquein.token';

// Cópia em memória: com o armazenamento bloqueado (navegação privada), a sessão vale enquanto a aba estiver aberta.
let memoryToken: string | null = null;

export const tokenStore = {
  get: () => readLocal(TOKEN_KEY) ?? memoryToken,
  set: (token: string) => {
    memoryToken = token;
    writeLocal(TOKEN_KEY, token);
  },
  clear: () => {
    memoryToken = null;
    removeLocal(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Erros de validação por campo, no formato { campo: [mensagens] }. */
  get fieldErrors(): Record<string, string[]> {
    return this.code === 'VALIDATION_ERROR' && this.details ? (this.details as Record<string, string[]>) : {};
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(`${BASE_URL}/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

async function request(path: string, init: RequestInit & { query?: Query } = {}) {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, init.query), { ...init, headers });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar à API. Ela está rodando?');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      tokenStore.clear();
      window.dispatchEvent(new Event('estoquein:unauthorized'));
    }
    throw new ApiError(
      response.status,
      body?.error?.message ?? `Erro ${response.status}`,
      body?.error?.code,
      body?.error?.details,
    );
  }
  return response;
}

async function json<T>(path: string, init: RequestInit & { query?: Query } = {}): Promise<T> {
  const response = await request(path, init);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const withBody = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  get: <T>(path: string, query?: Query) => json<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => json<T>(path, withBody('POST', body)),
  patch: <T>(path: string, body?: unknown) => json<T>(path, withBody('PATCH', body)),
  put: <T>(path: string, body?: unknown) => json<T>(path, withBody('PUT', body)),
  delete: <T = void>(path: string) => json<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File, query?: Query, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    return json<T>(path, { method: 'POST', body: form, query });
  },
  /** Baixa um arquivo autenticado (ex.: exportação CSV). */
  download: async (path: string, filename: string, query?: Query) => {
    const response = await request(path, { query });
    const url = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    // Alguns navegadores só baixam se o link estiver na página e o endereço ainda existir depois do clique.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
