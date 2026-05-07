export interface HealthInfo {
  status: string;
  version?: string;
  auth_required?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  key_name?: string;
  agent_scopes?: string[];
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

async function parseError(res: Response): Promise<ApiError> {
  const text = await res.text();
  let code = `HTTP_${res.status}`;
  let message = text || res.statusText;
  try {
    const body = JSON.parse(text);
    if (body?.error?.code) {
      code = body.error.code;
      message = body.error.message ?? message;
    } else if (body?.detail) {
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    // body is not JSON
  }
  return new ApiError(code, message, res.status);
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return h;
  }

  async health(): Promise<HealthInfo> {
    const res = await fetch(joinUrl(this.baseUrl, '/health'), {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as HealthInfo;
  }

  async verifyKey(): Promise<VerifyResult> {
    const res = await fetch(joinUrl(this.baseUrl, '/api/auth/keys/verify'), {
      method: 'POST',
      headers: this.headers(),
    });
    if (res.status === 404) {
      // Backend hasn't shipped /verify yet — fall back to /api/agents probe.
      const probe = await fetch(joinUrl(this.baseUrl, '/api/agents'), {
        method: 'GET',
        headers: this.headers(),
      });
      if (probe.ok) return { ok: true };
      throw await parseError(probe);
    }
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as VerifyResult;
  }
}
