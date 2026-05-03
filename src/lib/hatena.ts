import { parseStringPromise } from 'xml2js';
import { BlogInfo, Env } from '../types';

const HATENA_HOST = 'https://www.hatena.com';

function percentEncode(input: string): string {
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%7E/g, '~');
}

function buildBaseString(method: string, url: string, params: Record<string, string>) {
  const normalized = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  return [method.toUpperCase(), percentEncode(url), percentEncode(normalized)].join('&');
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  const bytes = new Uint8Array(sig);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}

function oauthParams(base: {
  consumerKey: string;
  token?: string;
  callback?: string;
  verifier?: string;
}) {
  const params: Record<string, string> = {
    oauth_consumer_key: base.consumerKey,
    oauth_nonce: crypto.randomUUID(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
  };
  if (base.token) params['oauth_token'] = base.token;
  if (base.callback) params['oauth_callback'] = base.callback;
  if (base.verifier) params['oauth_verifier'] = base.verifier;
  return params;
}

function buildAuthHeader(params: Record<string, string>) {
  const kv = Object.keys(params)
    .filter((k) => k.startsWith('oauth_'))
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(params[k])}"`)
    .join(', ');
  return `OAuth ${kv}`;
}

async function signedRequest(
  method: string,
  url: string,
  oauth: {
    consumerKey: string;
    consumerSecret: string;
    token?: string;
    tokenSecret?: string;
    callback?: string;
    verifier?: string;
  },
  extraParams: Record<string, string> = {},
  fetchOptions: RequestInit = {},
): Promise<Response> {
  const parsedUrl = new URL(url);
  const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
  const params = { ...oauthParams(oauth), ...queryParams, ...extraParams };
  const signatureBase = buildBaseString(method, parsedUrl.origin + parsedUrl.pathname, params);
  const signingKey = `${percentEncode(oauth.consumerSecret)}&${oauth.tokenSecret ? percentEncode(oauth.tokenSecret) : ''}`;
  const signature = await hmacSha1(signingKey, signatureBase);
  params['oauth_signature'] = signature;
  const headers = new Headers(fetchOptions.headers);
  headers.set('Authorization', buildAuthHeader(params));
  return fetch(url, { ...fetchOptions, method, headers });
}

export async function getRequestToken(env: Env, callbackUrl: string) {
  // Hatena Blog AtomPub API requires both read_private and write_private for all entry operations.
  const scope = 'read_private,write_private';
  const bodyParams = new URLSearchParams({ scope });
  const resp = await signedRequest(
    'POST',
    `${HATENA_HOST}/oauth/initiate`,
    {
      consumerKey: env.HATENA_CONSUMER_KEY,
      consumerSecret: env.HATENA_CONSUMER_SECRET,
      callback: callbackUrl,
    },
    { scope },
    {
      body: bodyParams.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
  );
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Hatena request token failed: ${resp.status} ${text}`);
  const params = new URLSearchParams(text);
  const oauthToken = params.get('oauth_token');
  const oauthTokenSecret = params.get('oauth_token_secret');
  if (!oauthToken || !oauthTokenSecret) throw new Error('Invalid request token response');
  return { requestToken: oauthToken, requestTokenSecret: oauthTokenSecret };
}

export async function exchangeAccessToken(env: Env, token: string, tokenSecret: string, verifier: string) {
  const resp = await signedRequest(
    'POST',
    `${HATENA_HOST}/oauth/token`,
    {
      consumerKey: env.HATENA_CONSUMER_KEY,
      consumerSecret: env.HATENA_CONSUMER_SECRET,
      token,
      tokenSecret,
      verifier,
    },
  );
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Hatena access token failed: ${resp.status} ${text}`);
  const params = new URLSearchParams(text);
  const accessToken = params.get('oauth_token');
  const accessSecret = params.get('oauth_token_secret');
  const hatenaId = params.get('url_name') ?? undefined;
  if (!accessToken || !accessSecret) throw new Error('Invalid access token response');
  return { accessToken, accessSecret, hatenaId };
}

function entryFeedUrl(hatenaId: string, blogId: string) {
  return `https://blog.hatena.ne.jp/${hatenaId}/${blogId}/atom/entry`;
}

function buildEntryXml(input: { title: string; content: string; draft?: boolean }) {
  const draftTag = input.draft ? '<app:control><app:draft>yes</app:draft></app:control>' : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom" xmlns:app="http://www.w3.org/2007/app">
  <title>${escapeXml(input.title)}</title>
  <content type="text/plain">${escapeXml(input.content)}</content>
  ${draftTag}
</entry>`;
}

function escapeXml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function signedAtomRequest(
  env: Env,
  user: { accessToken: string; accessSecret: string; hatenaId: string },
  method: string,
  url: string,
  body?: BodyInit,
  contentType?: string,
) {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  return signedRequest(
    method,
    url,
    {
      consumerKey: env.HATENA_CONSUMER_KEY,
      consumerSecret: env.HATENA_CONSUMER_SECRET,
      token: user.accessToken,
      tokenSecret: user.accessSecret,
    },
    {},
    { body, headers },
  );
}

export async function listEntries(env: Env, user: { accessToken: string; accessSecret: string; hatenaId: string }, blogId: string, opts?: { limit?: number; offset?: number }) {
  const url = new URL(entryFeedUrl(user.hatenaId, blogId));
  if (opts?.limit) url.searchParams.set('max-results', String(opts.limit));
  if (opts?.offset) url.searchParams.set('start-index', String(opts.offset + 1));
  const resp = await signedAtomRequest(env, user, 'GET', url.toString());
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Hatena list failed: ${resp.status} ${text}`);
  const parsed = await parseStringPromise(text, { explicitArray: false, explicitRoot: false });
  const entries = Array.isArray(parsed.entry) ? parsed.entry : parsed.entry ? [parsed.entry] : [];
  return {
    raw: text,
    entries: entries.map((e: any) => ({
      id: e.id,
      title: e.title,
      updated: e.updated,
      draft: e['app:control']?.['app:draft'] === 'yes',
    })),
  };
}

export async function createEntry(env: Env, user: { accessToken: string; accessSecret: string; hatenaId: string }, blogId: string, input: { title: string; content: string; draft?: boolean }) {
  const body = buildEntryXml(input);
  const resp = await signedAtomRequest(env, user, 'POST', entryFeedUrl(user.hatenaId, blogId), body, 'application/xml');
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Hatena create failed: ${resp.status} ${text}`);
  return { raw: text };
}

export async function getEntry(env: Env, user: { accessToken: string; accessSecret: string; hatenaId: string }, blogId: string, entryId: string) {
  const url = `${entryFeedUrl(user.hatenaId, blogId)}/${entryId}`;
  const resp = await signedAtomRequest(env, user, 'GET', url);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Hatena get entry failed: ${resp.status} ${text}`);
  const parsed = await parseStringPromise(text, { explicitArray: false, explicitRoot: false });
  return {
    raw: text,
    entry: {
      id: parsed.id,
      title: parsed.title,
      updated: parsed.updated,
      published: parsed.published,
      content: parsed.content?._ ?? parsed.content,
      draft: parsed['app:control']?.['app:draft'] === 'yes',
    },
  };
}

export async function updateEntry(env: Env, user: { accessToken: string; accessSecret: string; hatenaId: string }, blogId: string, entryId: string, input: { title?: string; content?: string; draft?: boolean }) {
  const url = `${entryFeedUrl(user.hatenaId, blogId)}/${entryId}`;
  // minimal: require title/content provided; otherwise leave empty
  const body = buildEntryXml({
    title: input.title ?? '',
    content: input.content ?? '',
    draft: input.draft,
  });
  const resp = await signedAtomRequest(env, user, 'PUT', url, body, 'application/xml');
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Hatena update failed: ${resp.status} ${text}`);
  return { raw: text };
}

export function buildAuthorizeUrl(token: string, state: string) {
  const url = new URL('https://www.hatena.ne.jp/oauth/authorize');
  url.searchParams.set('oauth_token', token);
  url.searchParams.set('state', state);
  return url.toString();
}

export type HatenaUserSession = {
  accessToken: string;
  accessSecret: string;
  hatenaId: string;
  blogs?: BlogInfo[];
};
