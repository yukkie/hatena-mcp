import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Env } from '../types';
import { clearUserHatena, getUserState, saveUserBlog, storeOAuthState } from '../lib/state';
import { buildAuthorizeUrl, createEntry, getEntry, getRequestToken, listEntries, updateEntry } from '../lib/hatena';
import * as z from 'zod';

type HatenaSession = {
  accessToken: string;
  accessSecret: string;
  hatenaId: string;
  blogs?: import('../types').BlogInfo[];
};

function ensureHatenaSession(state: Awaited<ReturnType<typeof getUserState>>): HatenaSession {
  if (!state?.hatena || !state.hatena.hatenaId) {
    throw new Error('Hatena account not linked');
  }
  return state.hatena as HatenaSession;
}

/**
 * Extract blogId and optional entryId from a Hatena URL.
 *
 * Supported patterns:
 *   https://nagwiki.hatenadiary.org/entry/...   → blogId only
 *   https://blog.hatena.ne.jp/{user}/{blogId}/edit?entry={entryId} → blogId + entryId
 */
function parseHatenaUrl(url: string): { blogId: string; entryId?: string } | null {
  try {
    const parsed = new URL(url);
    // Admin edit URL: blog.hatena.ne.jp/{user}/{blogId}/edit?entry={entryId}
    if (parsed.hostname === 'blog.hatena.ne.jp') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      const blogId = segments[1];
      const entryId = parsed.searchParams.get('entry') ?? undefined;
      if (!blogId) return null;
      return { blogId, entryId };
    }
    // Blog entry URL: {blogId}/entry/...
    return { blogId: parsed.hostname };
  } catch {
    return null;
  }
}

async function buildOAuthStartResponse(env: Env, userId: string, requestUrl: string) {
  const state = crypto.randomUUID();
  const callbackUrl = new URL('/hatena/oauth/callback', requestUrl).toString();
  const { requestToken, requestTokenSecret } = await getRequestToken(env, callbackUrl);
  const record = { userId, requestToken, requestTokenSecret, createdAt: new Date().toISOString() };
  await storeOAuthState(env, state, record);
  await storeOAuthState(env, requestToken, record);
  const authorizeUrl = buildAuthorizeUrl(requestToken, state);
  return {
    content: [{
      type: 'text' as const,
      text: `Hatena account not linked. Please visit the following URL to authorize:\n${authorizeUrl}`,
    }],
  };
}

/**
 * Resolve blogId from args. Priority:
 *   1. args.blogId directly provided
 *   2. args.url provided → extract hostname or blog.hatena.ne.jp path segment
 *   3. first saved blog in user state
 * Returns null if none found, along with an optional entryId from the URL.
 */
async function resolveBlogId(
  env: Env,
  userId: string,
  args: { blogId?: string; url?: string },
): Promise<{ blogId: string | null; entryIdFromUrl?: string }> {
  if (args.blogId) return { blogId: args.blogId };

  if (args.url) {
    const parsed = parseHatenaUrl(args.url);
    if (parsed) {
      await saveUserBlog(env, userId, { blogId: parsed.blogId, url: args.url });
      return { blogId: parsed.blogId, entryIdFromUrl: parsed.entryId };
    }
  }

  const state = await getUserState(env, userId);
  const saved = state?.hatena?.blogs?.[0]?.blogId ?? null;
  return { blogId: saved };
}

export function buildMcpServer(env: Env, userId: string, requestUrl: string) {
  const server = new McpServer(
    { name: 'hatena-blog-mcp', version: '1.0.0' },
    { jsonSchemaValidator: undefined }
  );

  server.registerTool(
    'start_hatena_oauth',
    {
      title: 'Begin Hatena OAuth flow',
      description: 'Returns the authorization URL to link Hatena Blog.',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        authorizeUrl: z.string().url(),
        state: z.string(),
      }),
    },
    async () => {
      try {
        const state = crypto.randomUUID();
        const callbackUrl = new URL('/hatena/oauth/callback', requestUrl).toString();
        const { requestToken, requestTokenSecret } = await getRequestToken(env, callbackUrl);
        const record = {
          userId,
          requestToken,
          requestTokenSecret,
          createdAt: new Date().toISOString(),
        };
        // Store by state and by requestToken (Hatena may not echo state back)
        await storeOAuthState(env, state, record);
        await storeOAuthState(env, requestToken, record);
        const authorizeUrl = buildAuthorizeUrl(requestToken, state);
        const payload = { authorizeUrl, state };
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'start_hatena_oauth failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'list_entries',
    {
      title: 'List Hatena blog entries',
      description: 'Fetches entries for a blog. Pass blogId, a Hatena blog URL, or omit to use the saved blog.',
      inputSchema: z.object({
        blogId: z.string().optional(),
        url: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }),
    },
    async (args) => {
      try {
        const userState = await getUserState(env, userId);
        if (!userState?.hatena?.hatenaId) return buildOAuthStartResponse(env, userId, requestUrl);
        const hatena = userState.hatena as ReturnType<typeof ensureHatenaSession>;

        const { blogId } = await resolveBlogId(env, userId, args);
        if (!blogId) {
          return {
            content: [{ type: 'text', text: 'No blog registered yet. Please provide your Hatena blog URL and I\'ll register it automatically.' }],
          };
        }

        const data = await listEntries(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          blogId,
          { limit: args.limit, offset: args.offset },
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'list_entries failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'create_entry',
    {
      title: 'Create Hatena blog entry',
      description: 'Creates a new entry. Pass blogId, a Hatena blog URL, or omit to use the saved blog.',
      inputSchema: z.object({
        blogId: z.string().optional(),
        url: z.string().optional(),
        title: z.string(),
        content: z.string(),
        draft: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        const userState = await getUserState(env, userId);
        if (!userState?.hatena?.hatenaId) return buildOAuthStartResponse(env, userId, requestUrl);
        const hatena = userState.hatena as ReturnType<typeof ensureHatenaSession>;

        const { blogId } = await resolveBlogId(env, userId, args);
        if (!blogId) {
          return {
            content: [{ type: 'text', text: 'No blog registered yet. Please provide your Hatena blog URL and I\'ll register it automatically.' }],
          };
        }

        const result = await createEntry(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          blogId,
          { title: args.title, content: args.content, draft: args.draft },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'create_entry failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'get_entry',
    {
      title: 'Get Hatena blog entry',
      description: 'Fetches a single entry by entryId. Pass the Hatena admin edit URL (https://blog.hatena.ne.jp/{user}/{blogId}/edit?entry={entryId}) to auto-extract blogId and entryId, or provide them directly.',
      inputSchema: z.object({
        blogId: z.string().optional(),
        entryId: z.string().optional(),
        url: z.string().optional(),
      }),
    },
    async (args) => {
      try {
        const userState = await getUserState(env, userId);
        if (!userState?.hatena?.hatenaId) return buildOAuthStartResponse(env, userId, requestUrl);
        const hatena = userState.hatena as ReturnType<typeof ensureHatenaSession>;

        const { blogId, entryIdFromUrl } = await resolveBlogId(env, userId, args);
        const entryId = args.entryId ?? entryIdFromUrl;

        if (!blogId) {
          return {
            content: [{ type: 'text', text: 'No blog registered yet. Please provide your Hatena blog URL and I\'ll register it automatically.' }],
          };
        }

        if (!entryId) {
          return {
            content: [{
              type: 'text',
              text: 'Could not determine the entry ID. Please provide the Hatena admin edit URL in the format:\nhttps://blog.hatena.ne.jp/{username}/{blogId}/edit?entry={entryId}',
            }],
          };
        }

        const result = await getEntry(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          blogId,
          entryId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'get_entry failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'update_entry',
    {
      title: 'Update Hatena blog entry',
      description: 'Updates an existing entry. Pass the Hatena admin edit URL (https://blog.hatena.ne.jp/{user}/{blogId}/edit?entry={entryId}) to auto-extract blogId and entryId, or provide them directly.',
      inputSchema: z.object({
        blogId: z.string().optional(),
        entryId: z.string().optional(),
        url: z.string().optional(),
        title: z.string().optional(),
        content: z.string().optional(),
        draft: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        const userState = await getUserState(env, userId);
        if (!userState?.hatena?.hatenaId) return buildOAuthStartResponse(env, userId, requestUrl);
        const hatena = userState.hatena as ReturnType<typeof ensureHatenaSession>;

        const { blogId, entryIdFromUrl } = await resolveBlogId(env, userId, args);
        const entryId = args.entryId ?? entryIdFromUrl;

        if (!blogId) {
          return {
            content: [{ type: 'text', text: 'No blog registered yet. Please provide your Hatena blog URL and I\'ll register it automatically.' }],
          };
        }

        if (!entryId) {
          return {
            content: [{
              type: 'text',
              text: 'Could not determine the entry ID. Please provide the Hatena admin edit URL in the format:\nhttps://blog.hatena.ne.jp/{username}/{blogId}/edit?entry={entryId}',
            }],
          };
        }

        const result = await updateEntry(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          blogId,
          entryId,
          { title: args.title, content: args.content, draft: args.draft },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'update_entry failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'save_blog',
    {
      title: 'Save Hatena blog metadata',
      description: 'Stores a blogId (and optional title/url) for later reuse.',
      inputSchema: z.object({
        blogId: z.string(),
        title: z.string().optional(),
        url: z.string().url().optional(),
      }),
    },
    async (args) => {
      try {
        ensureHatenaSession(await getUserState(env, userId));
        const state = await saveUserBlog(env, userId, { blogId: args.blogId, title: args.title, url: args.url });
        const blogs = state.hatena?.blogs ?? [];
        return { content: [{ type: 'text', text: JSON.stringify({ saved: args.blogId, blogs }) }], structuredContent: { saved: args.blogId, blogs } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'save_blog failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'list_saved_blogs',
    {
      title: 'List saved Hatena blogs',
      description: 'Returns blogId/title/url saved in the user state.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      try {
        const state = ensureHatenaSession(await getUserState(env, userId));
        const blogs = state.blogs ?? [];
        return { content: [{ type: 'text', text: JSON.stringify({ blogs }) }], structuredContent: { blogs } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'list_saved_blogs failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'reset_hatena_session',
    {
      title: 'Clear stored Hatena tokens',
      description: 'Deletes the linked Hatena account from durable storage so you can re-authenticate cleanly.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      try {
        await clearUserHatena(env, userId);
        return { content: [{ type: 'text', text: 'Hatena session cleared. Run start_hatena_oauth again.' }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'reset_hatena_session failed' }], isError: true };
      }
    }
  );

  return server;
}

export async function handleMcpRequest(server: McpServer, transport: Transport, c: any) {
  await server.connect(transport as unknown as Transport);
  return (transport as any).handleRequest(c);
}
