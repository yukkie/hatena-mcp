# CLAUDE.md

## プロジェクト概要

ChatGPT / Claude などの MCP クライアントからはてなブログを操作できる MCP Server。
Cloudflare Workers + Durable Objects で動作するサーバーレス実装。

## 技術スタック

- **Runtime**: Cloudflare Workers（Durable Objects 必須）
- **Framework**: Hono
- **言語**: TypeScript
- **パッケージマネージャ**: Bun
- **認証**: OAuth 2.1 + PKCE（MCP クライアント側）/ OAuth 1.0a（はてな API 側）

## コマンド

```bash
bun install          # 依存インストール
bun run dev          # ローカル開発サーバー（wrangler dev --local）
bun run deploy       # Cloudflare へデプロイ
bun run setup        # JWT 鍵ペア・OAuth クライアント情報生成
wrangler types       # 型定義更新
```

## ディレクトリ構成

```
src/
├── index.ts              # エントリーポイント
├── types.ts              # 型定義
├── routes/               # HTTP ルート（Hono）
│   ├── discovery.ts      # /.well-known/*
│   ├── oauth.ts          # /oauth/*
│   ├── hatena-callback.ts # /hatena/oauth/callback
│   ├── mcp.ts            # /mcp
│   └── home.ts
├── do/                   # Durable Object 定義
│   ├── user-do.ts        # ユーザー状態（はてな access token）
│   ├── client-do.ts      # OAuth クライアント情報
│   ├── auth-code-do.ts   # 認可コード（TTL: 10 分）
│   ├── oauth-state-do.ts # はてな OAuth 一時状態
│   └── access-token-do.ts
├── lib/                  # ビジネスロジック
│   ├── jwt.ts            # JWT 署名・検証（RS256）
│   ├── hatena.ts         # はてな API 呼び出し
│   ├── auth.ts           # 認証ヘルパー
│   ├── state.ts          # Durable Object 操作ヘルパー
│   └── crypto.ts         # PKCE 用 SHA-256
└── mcp/
    └── server.ts         # MCP ツール定義とハンドラ
scripts/
└── setup-oauth.ts        # 初期セットアップスクリプト
```

## 環境変数

`.dev.vars.example` をコピーして `.dev.vars` を作成する。
`bun run setup` で `JWT_PUBLIC_KEY` / `JWT_PRIVATE_KEY` / `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` を生成できる。

| 変数名 | 説明 |
|---|---|
| `HATENA_CONSUMER_KEY` | はてな OAuth アプリの Consumer Key |
| `HATENA_CONSUMER_SECRET` | はてな OAuth アプリの Consumer Secret |
| `OAUTH_ISSUER` | Workers の公開 URL（例: `https://your-worker.workers.dev`）|
| `OAUTH_CLIENT_ID` | MCP クライアント ID（setup で生成）|
| `OAUTH_CLIENT_SECRET` | MCP クライアントシークレット（setup で生成）|
| `OAUTH_REDIRECT_URIS` | コールバック URI カンマ区切り |
| `JWT_PUBLIC_KEY` | RS256 公開鍵（JWK 形式、setup で生成）|
| `JWT_PRIVATE_KEY` | RS256 秘密鍵（JWK 形式、setup で生成）|
| `SETUP_SECRET` | `/oauth/setup` 管理者 Bearer トークン |

## セットアップ手順

1. `bun install`
2. `.dev.vars.example` → `.dev.vars` にコピーして編集
3. `bun run setup` → 出力を `.dev.vars` に貼り付け
4. [はてな OAuth アプリ登録](https://www.hatena.ne.jp/oauth/develop) → Consumer Key/Secret を取得
5. Cloudflare にログイン（`wrangler login`）
6. `bun run deploy` でデプロイ
7. `/oauth/setup` エンドポイントで OAuth クライアントを登録（初回のみ）
8. MCP クライアント（ChatGPT / Claude）に `/mcp` エンドポイントを OAuth 設定付きで登録

## ローカル開発の制限

- `wrangler dev --local` でサーバー起動は可能
- ただし OAuth コールバック（はてな → Worker）には公開 URL が必要なため、実際の OAuth フローは Cloudflare デプロイ後のみ動作する
- ローカルでは API ルーティングや型チェック程度の確認にとどまる

## 注意事項

- Durable Objects を使用しているため、他のホスティング環境への移植は非自明
- fork 元: `kiyo-e/2025-11-27-hatena-mcp`
- Issue 管理: `yukkie/hatena-mcp`
