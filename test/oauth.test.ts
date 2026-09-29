import { describe, expect, it } from 'vitest';
import {
  type OAuthClient,
  OAuthError,
  OAuthSession,
  type StoredToken,
  type TokenStore,
  beginAuthorization,
  deliverUriCallback,
  isFresh,
  listenOnLoopback,
  listenOnUri,
  parseTokenResponse,
  pkceChallenge,
  readCallback,
  tokenRequest,
} from '../src/extension/pullRequests/oauth';

const GITLAB: OAuthClient = {
  provider: 'GitLab',
  authorizeUrl: 'https://gitlab.com/oauth/authorize',
  tokenUrl: 'https://gitlab.com/oauth/token',
  clientId: 'app-id',
  scope: 'api',
  pkce: true,
  sendRedirectUri: true,
};

const BITBUCKET: OAuthClient = {
  provider: 'Bitbucket',
  authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize',
  tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
  clientId: 'consumer-key',
  clientSecret: 'consumer-secret',
  pkce: false,
  sendRedirectUri: false,
};

const REDIRECT = 'vscode://javian-picardo-group-inc.git-tree/oauth/gitlab';

function memoryStore(initial?: StoredToken): TokenStore & { value: string | undefined } {
  const store = {
    value: initial ? JSON.stringify(initial) : undefined,
    get: async () => store.value,
    set: async (value: string) => {
      store.value = value;
    },
    clear: async () => {
      store.value = undefined;
    },
  };
  return store;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('beginAuthorization', () => {
  it('asks GitLab for a code with PKCE, scope, and the registered redirect', () => {
    const auth = beginAuthorization(GITLAB, REDIRECT);
    const url = new URL(auth.url);

    expect(url.origin + url.pathname).toBe('https://gitlab.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('app-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('scope')).toBe('api');
    expect(url.searchParams.get('state')).toBe(auth.state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(auth.verifier!));
  });

  it('sends Bitbucket neither a redirect nor a challenge — its consumer defines both', () => {
    const url = new URL(beginAuthorization(BITBUCKET, 'http://127.0.0.1:47231/oauth/bitbucket').url);
    expect(url.searchParams.has('redirect_uri')).toBe(false);
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.get('client_id')).toBe('consumer-key');
  });

  it('uses a fresh, unguessable state every time', () => {
    const states = new Set(Array.from({ length: 20 }, () => beginAuthorization(GITLAB, REDIRECT).state));
    expect(states.size).toBe(20);
    for (const state of states) expect(state.length).toBeGreaterThanOrEqual(32);
  });
});

describe('readCallback', () => {
  it('returns the code when the state matches', () => {
    expect(readCallback('?code=abc&state=s1', 's1')).toBe('abc');
  });

  it('refuses a callback whose state does not match — a forged or stale link', () => {
    expect(() => readCallback('code=abc&state=other', 's1')).toThrow(/did not match/);
  });

  it('reports a denied authorization as a cancellation', () => {
    expect(() => readCallback('error=access_denied&state=s1', 's1')).toThrow(/cancelled/);
  });

  it('passes on the provider’s own error description', () => {
    expect(() => readCallback('error=invalid_scope&error_description=Bad+scope&state=s1', 's1')).toThrow(
      'Sign-in failed: Bad scope',
    );
  });

  it('refuses a callback with no code', () => {
    expect(() => readCallback('state=s1', 's1')).toThrow(OAuthError);
  });
});

describe('tokenRequest', () => {
  it('exchanges a GitLab code as a public client: client_id, verifier, and redirect in the body', () => {
    const { url, init } = tokenRequest(GITLAB, { kind: 'code', code: 'c', redirectUri: REDIRECT, verifier: 'v' });
    const body = new URLSearchParams(init.body as string);

    expect(url).toBe('https://gitlab.com/oauth/token');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('app-id');
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('redirect_uri')).toBe(REDIRECT);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('exchanges a Bitbucket code as a confidential client: key and secret as HTTP Basic', () => {
    const { init } = tokenRequest(BITBUCKET, { kind: 'code', code: 'c', redirectUri: 'ignored' });
    const body = new URLSearchParams(init.body as string);
    const auth = (init.headers as Record<string, string>).Authorization;

    expect(auth).toBe(`Basic ${Buffer.from('consumer-key:consumer-secret').toString('base64')}`);
    expect(body.has('client_id')).toBe(false);
    expect(body.has('redirect_uri')).toBe(false);
    expect(body.get('code')).toBe('c');
  });

  it('refreshes a GitLab token with the verifier and redirect it was issued with', () => {
    const { init } = tokenRequest(GITLAB, {
      kind: 'refresh',
      token: { accessToken: 'a', refreshToken: 'r', verifier: 'v', redirectUri: REDIRECT },
    });
    const body = new URLSearchParams(init.body as string);

    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r');
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('redirect_uri')).toBe(REDIRECT);
  });
});

describe('parseTokenResponse / isFresh', () => {
  it('turns expires_in into an absolute expiry', () => {
    const token = parseTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 7200 }, 1_000);
    expect(token).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1_000 + 7_200_000 });
  });

  it('rejects a response with no access token', () => {
    expect(() => parseTokenResponse({ error: 'nope' }, 0)).toThrow(OAuthError);
  });

  it('treats a token as stale a minute before it actually expires', () => {
    expect(isFresh({ accessToken: 'a', expiresAt: 200_000 }, 100_000)).toBe(true);
    expect(isFresh({ accessToken: 'a', expiresAt: 200_000 }, 150_000)).toBe(false);
    expect(isFresh({ accessToken: 'a' }, Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});

describe('URI handler callbacks', () => {
  it('routes a callback to the sign-in waiting on its state, and ignores unknown states', async () => {
    const listener = listenOnUri(REDIRECT);
    const pending = listener.next('state-1');

    expect(deliverUriCallback('code=x&state=someone-else')).toBe(false);
    expect(deliverUriCallback('code=x&state=state-1')).toBe(true);
    await expect(pending).resolves.toBe('code=x&state=state-1');
    // Delivered once; a replay of the same link finds nothing waiting.
    expect(deliverUriCallback('code=x&state=state-1')).toBe(false);
    listener.dispose();
  });
});

describe('loopback callbacks', () => {
  it('receives the browser on 127.0.0.1, answers with a page, and hands over the query', async () => {
    const port = 47_000 + Math.floor(Math.random() * 900);
    const listener = await listenOnLoopback(port, '/oauth/bitbucket', 'Bitbucket');

    try {
      expect(listener.redirectUri).toBe(`http://127.0.0.1:${port}/oauth/bitbucket`);

      const missing = await fetch(`http://127.0.0.1:${port}/elsewhere`);
      expect(missing.status).toBe(404);

      const page = await fetch(`${listener.redirectUri}?code=abc&state=s1`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Signed in to Bitbucket');
      await expect(listener.next('s1')).resolves.toBe('?code=abc&state=s1');
    } finally {
      listener.dispose();
    }
  });
});

describe('OAuthSession', () => {
  const now = () => 1_000_000;

  it('returns a stored token that is still fresh, without any request', async () => {
    const session = new OAuthSession({
      client: GITLAB,
      store: memoryStore({ accessToken: 'live', expiresAt: 9_000_000 }),
      listen: async () => listenOnUri(REDIRECT),
      openBrowser: async () => true,
      fetch: async () => {
        throw new Error('should not be called');
      },
      now,
    });
    await expect(session.accessToken()).resolves.toBe('live');
  });

  it('refreshes an expired token and stores the new one, keeping the refresh token if not rotated', async () => {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'r1', expiresAt: 0 });
    const requests: string[] = [];
    const session = new OAuthSession({
      client: BITBUCKET,
      store,
      listen: async () => listenOnUri(REDIRECT),
      openBrowser: async () => true,
      fetch: async (_url, init) => {
        requests.push(String(init?.body));
        return jsonResponse(200, { access_token: 'new', expires_in: 3600 });
      },
      now,
    });

    await expect(session.accessToken()).resolves.toBe('new');
    expect(requests[0]).toContain('grant_type=refresh_token');
    expect(JSON.parse(store.value!)).toMatchObject({ accessToken: 'new', refreshToken: 'r1' });
  });

  it('forgets a token whose refresh the provider refuses, so sign-in is offered again', async () => {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'revoked', expiresAt: 0 });
    const session = new OAuthSession({
      client: BITBUCKET,
      store,
      listen: async () => listenOnUri(REDIRECT),
      openBrowser: async () => true,
      fetch: async () => jsonResponse(400, { error: 'invalid_grant' }),
      now,
    });

    await expect(session.accessToken()).resolves.toBeUndefined();
    expect(store.value).toBeUndefined();
  });

  it('signs in end to end: opens the browser, takes the callback, exchanges the code, stores the token', async () => {
    const store = memoryStore();
    let opened = '';
    let exchanged: URLSearchParams | undefined;

    const session = new OAuthSession({
      client: GITLAB,
      store,
      listen: async () => listenOnUri(REDIRECT),
      openBrowser: async (url) => {
        opened = url;
        // The "browser": GitLab sends it back with a code and the same state.
        const state = new URL(url).searchParams.get('state');
        setTimeout(() => deliverUriCallback(`code=the-code&state=${state}`), 5);
        return true;
      },
      fetch: async (_url, init) => {
        exchanged = new URLSearchParams(init?.body as string);
        return jsonResponse(200, { access_token: 'granted', refresh_token: 'r', expires_in: 7200 });
      },
      now,
    });

    await expect(session.signIn()).resolves.toBe('granted');
    expect(opened).toContain('https://gitlab.com/oauth/authorize');
    expect(exchanged?.get('code')).toBe('the-code');
    expect(exchanged?.get('code_verifier')).toBeTruthy();
    expect(JSON.parse(store.value!)).toMatchObject({ accessToken: 'granted', refreshToken: 'r', redirectUri: REDIRECT });
    await expect(session.accessToken()).resolves.toBe('granted');
  });

  it('gives up cleanly when the browser never comes back', async () => {
    const session = new OAuthSession({
      client: GITLAB,
      store: memoryStore(),
      listen: async () => listenOnUri(REDIRECT),
      openBrowser: async () => true,
      fetch: async () => jsonResponse(500, {}),
      now,
      timeoutMs: 20,
    });
    await expect(session.signIn()).rejects.toThrow(/timed out/);
  });

  it('stops waiting when the user cancels', async () => {
    const controller = new AbortController();
    const session = new OAuthSession({
      client: GITLAB,
      store: memoryStore(),
      listen: async () => listenOnUri(REDIRECT),
      openBrowser: async () => {
        setTimeout(() => controller.abort(), 5);
        return true;
      },
      now,
    });
    await expect(session.signIn(controller.signal)).rejects.toThrow(/cancelled/);
  });

  it('surfaces the provider’s reason when the code exchange is refused', async () => {
    const session = new OAuthSession({
      client: BITBUCKET,
      store: memoryStore(),
      listen: async () => listenOnUri(REDIRECT),
      openBrowser: async (url) => {
        const state = new URL(url).searchParams.get('state');
        setTimeout(() => deliverUriCallback(`code=c&state=${state}`), 5);
        return true;
      },
      fetch: async () => jsonResponse(400, { error: 'invalid_client', error_description: 'Consumer not found' }),
      now,
    });
    await expect(session.signIn()).rejects.toThrow('Bitbucket rejected the sign-in (400): Consumer not found');
  });
});

describe('providerReason', () => {
  it('pulls Bitbucket’s nested error message out of a failed request', async () => {
    const { providerReason } = await import('../src/extension/pullRequests/oauth');
    const error = new Error('GET https://api.bitbucket.org/2.0/x failed: 401 {"type":"error","error":{"message":"Token is invalid or expired."}}');
    expect(providerReason(error)).toBe('Token is invalid or expired.');
  });

  it('reads GitLab’s flat message and OAuth error descriptions', async () => {
    const { providerReason } = await import('../src/extension/pullRequests/oauth');
    expect(providerReason(new Error('GET x failed: 401 {"message":"401 Unauthorized"}'))).toBe('401 Unauthorized');
    expect(providerReason(new Error('POST x failed: 400 {"error":"invalid_grant","error_description":"expired"}'))).toBe('expired');
    expect(providerReason(new Error('no body here'))).toBeUndefined();
  });
});
