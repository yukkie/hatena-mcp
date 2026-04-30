# Hatena Blog MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

ChatGPT経由ではてなブログを操作できるMCP（Model Context Protocol）サーバーです。Cloudflare Workers + Durable Objectsで動作する完全サーバーレスな実装です。

## 主な特徴

- **ChatGPTからはてなブログを直接操作**: 記事の閲覧、作成、更新が可能
- **セキュアな2層OAuth認証**:
  - ChatGPT ↔ MCPサーバー: OAuth 2.1 + PKCE + JWT (RS256)
  - MCPサーバー ↔ はてなブログ: OAuth 1.0a
- **完全サーバーレス**: Cloudflare Workers + Durable Objectsで運用コスト最小化
- **モジュラー設計**: ルート、Durable Object、ビジネスロジックを整理した保守性の高い実装

## デモ

```
User: 最新のブログ記事を3件表示して

ChatGPT: (list_entriesツールを使用)
1. タイトル1 - 2025-11-27
2. タイトル2 - 2025-11-26
3. タイトル3 - 2025-11-25

User: 新しい記事を下書きで作成して
タイトル: CloudflareでMCPサーバーを作った話
本文: ...

ChatGPT: (create_entryツールを使用)
下書きを作成しました！
```

## クイックスタート

### 前提条件

- [Bun](https://bun.sh/) v1.0以上
- Cloudflareアカウント
- はてなアカウント

### 1. インストール

```bash
git clone https://github.com/your-username/hatena-blog-mcp.git
cd hatena-blog-mcp
bun install
```

### 2. はてなOAuthアプリケーションの登録

1. [はてなのOAuthアプリケーション登録ページ](https://www.hatena.ne.jp/oauth/develop)にアクセス
2. 新規アプリケーションを作成
3. コールバックURL: `https://your-worker-name.workers.dev/hatena/oauth/callback`
4. **Consumer Key**と**Consumer Secret**を取得してメモ

### 3. OAuth認証情報の生成

以下のコマンドでJWT鍵ペアとOAuthクライアント情報を生成します：

```bash
bun run setup
```

出力された環境変数をコピーしておきます。

### 4. 環境変数の設定

`.dev.vars`ファイルを作成し、以下を設定：

```env
# はてなブログのOAuth 1.0a認証情報
HATENA_CONSUMER_KEY=your_hatena_consumer_key_here
HATENA_CONSUMER_SECRET=your_hatena_consumer_secret_here

# MCPサーバーのOAuth 2.1設定
OAUTH_ISSUER=https://your-worker-name.workers.dev
OAUTH_CLIENT_ID=generated_client_id_from_setup
OAUTH_CLIENT_SECRET=generated_client_secret_from_setup
OAUTH_REDIRECT_URIS=https://chatgpt.com/oauth-callback-url,https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback
SETUP_SECRET=a_strong_random_string_for_setup_auth

# JWT署名鍵（bun run setupで生成）
JWT_PUBLIC_KEY={"kid":"...","alg":"RS256",...}
JWT_PRIVATE_KEY={"kid":"...","alg":"RS256",...}
```

### 5. デプロイ

```bash
# Cloudflare Workersにデプロイ
bun run deploy

# デプロイ後、OAuthクライアントを登録（初回のみ）
curl -X POST https://your-worker-name.workers.dev/oauth/setup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SETUP_SECRET" \
  -d '{
    "client_id": "OAUTH_CLIENT_IDの値",
    "client_secret": "OAUTH_CLIENT_SECRETの値",
    "redirect_uris": [
      "https://chatgpt.com/oauth-callback-url",
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback"
    ]
  }'
```

### 6. ChatGPTに接続

1. ChatGPTのMCP設定を開く
2. 以下を設定：
   - **URL**: `https://your-worker-name.workers.dev/mcp`
   - **認証タイプ**: OAuth
   - **Client ID**: `OAUTH_CLIENT_ID`の値
   - **Client Secret**: `OAUTH_CLIENT_SECRET`の値
3. 接続後、`start_hatena_oauth`ツールではてなブログを連携

Claude で利用する場合は OAuth コールバック URL として `https://claude.ai/api/mcp/auth_callback`（将来的に `https://claude.com/api/mcp/auth_callback` へ移行する可能性あり）を `redirect_uris` に含めてください。

## 利用可能なMCPツール

### `start_hatena_oauth`

はてなブログとのOAuth連携を開始します。返されたURLにアクセスして認可を完了してください。

```json
// 入力: なし
// 出力:
{
  "authorizeUrl": "https://www.hatena.com/oauth/authorize?...",
  "state": "uuid-string"
}
```

### `list_entries`

ブログ記事の一覧を取得します。

```json
// 入力:
{
  "blogId": "username.hatenablog.com",  // 必須
  "limit": 10,                           // オプション
  "offset": 0                            // オプション
}
```

### `create_entry`

新しいブログ記事を作成します。

```json
// 入力:
{
  "blogId": "username.hatenablog.com",  // 必須
  "title": "記事のタイトル",              // 必須
  "content": "# 本文\nMarkdown形式",     // 必須
  "draft": true                          // オプション（デフォルト: false）
}
```

### `update_entry`

既存の記事を更新します。

```json
// 入力:
{
  "blogId": "username.hatenablog.com",  // 必須
  "entryId": "12345678901234567890",    // 必須
  "title": "新しいタイトル",              // オプション
  "content": "新しい本文",                // オプション
  "draft": false                         // オプション
}
```

### `save_blog`

よく使うブログIDを保存します。

```json
// 入力:
{
  "blogId": "username.hatenablog.com",  // 必須
  "title": "マイブログ",                  // オプション
  "url": "https://username.hatenablog.com" // オプション
}
```

### `list_saved_blogs`

保存済みのブログ一覧を取得します。

```json
// 入力: なし
```

## アーキテクチャ

### システム構成

```
┌─────────────────────────────────────────────────────────────┐
│                          ChatGPT                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ OAuth 2.1 + PKCE
                           │ Bearer JWT (RS256)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              MCP Server (Cloudflare Workers)                │
│                                                             │
│  ┌─────────────┐  ┌──────────────────────────────────┐    │
│  │   Routes    │  │      Durable Objects             │    │
│  │             │  │                                  │    │
│  │ ・discovery │  │ ・UserDurableObject              │    │
│  │ ・oauth     │  │   (ユーザー状態とトークン)        │    │
│  │ ・mcp       │  │ ・ClientDurableObject            │    │
│  │ ・callback  │  │   (OAuthクライアント情報)         │    │
│  └─────────────┘  │ ・AuthCodeDurableObject          │    │
│                   │   (認可コード、TTL: 10分)         │    │
│  ┌─────────────┐  │ ・OAuthStateDurableObject        │    │
│  │  Libraries  │  │   (はてなOAuth一時状態)          │    │
│  │             │  └──────────────────────────────────┘    │
│  │ ・jwt       │                                           │
│  │ ・hatena    │                                           │
│  │ ・state     │                                           │
│  │ ・crypto    │                                           │
│  └─────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ OAuth 1.0a
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               Hatena Blog AtomPub API                       │
└─────────────────────────────────────────────────────────────┘
```

### OAuth認証フロー

#### ChatGPT → MCPサーバー (OAuth 2.1 with PKCE)

1. ChatGPTが`/.well-known/oauth-protected-resource`でOAuth設定を取得
2. ChatGPTが`code_verifier`を生成し、`code_challenge = SHA256(code_verifier)`を計算
3. `/oauth/authorize`にユーザーをリダイレクト（`code_challenge`を含む）
4. MCPサーバーが認可コードを生成し`AuthCodeDurableObject`に保存
5. ChatGPTに認可コードを返す
6. ChatGPTが`/oauth/token`に認可コードと`code_verifier`を送信
7. MCPサーバーがPKCE検証（`SHA256(code_verifier) == code_challenge`）
8. 検証成功後、JWT（RS256署名）を発行
9. ChatGPTは以降`Authorization: Bearer <JWT>`で`/mcp`にアクセス

#### MCPサーバー → はてなブログ (OAuth 1.0a)

1. ChatGPTが`start_hatena_oauth`ツールを実行
2. MCPサーバーがはてなにrequest tokenを要求
3. request tokenと秘密鍵を`OAuthStateDurableObject`に一時保存
4. `authorizeUrl`をChatGPTに返す
5. ユーザーがはてなで認可
6. はてなが`/hatena/oauth/callback`にリダイレクト
7. MCPサーバーがaccess tokenを取得
8. access tokenを`UserDurableObject`に永続保存
9. 以降、はてなAPIへのリクエストにaccess tokenを使用

### ディレクトリ構造

```
src/
├── index.ts                    # エントリーポイント
├── types.ts                    # TypeScript型定義
│
├── routes/                     # HTTPルート（Honoアプリ）
│   ├── discovery.ts            # /.well-known/* エンドポイント
│   ├── oauth.ts                # /oauth/* エンドポイント
│   ├── hatena-callback.ts      # /hatena/oauth/callback
│   └── mcp.ts                  # /mcp エンドポイント
│
├── do/                         # Durable Object定義
│   ├── user-do.ts              # ユーザー状態管理
│   ├── client-do.ts            # OAuthクライアント管理
│   ├── auth-code-do.ts         # OAuth認可コード管理
│   ├── oauth-state-do.ts       # はてなOAuth状態管理
│   └── access-token-do.ts      # 将来の拡張用
│
├── lib/                        # ビジネスロジック
│   ├── jwt.ts                  # JWT署名・検証（RS256）
│   ├── hatena.ts               # はてなAPI呼び出し
│   ├── state.ts                # Durable Object操作ヘルパー
│   └── crypto.ts               # PKCE用SHA-256実装
│
└── mcp/                        # MCP Server実装
    └── server.ts               # MCPツール定義とハンドラ

scripts/
└── setup.ts                    # JWT鍵ペアとOAuth情報生成

wrangler.toml                   # Cloudflare Workers設定
package.json                    # 依存関係
```

## ローカル開発

### 開発サーバーの起動

```bash
bun run dev
```

開発サーバーは`http://localhost:8787`で起動します。

### ローカルでのテスト

```bash
# Well-knownエンドポイントの確認
curl http://localhost:8787/.well-known/oauth-protected-resource

# JWKSの確認
curl http://localhost:8787/oauth/jwks
```

### デバッグ

Cloudflare Workersのログを確認：

```bash
wrangler tail
```

## トラブルシューティング

### `invalid_client` エラーが出る

`/oauth/setup`エンドポイントでクライアントを登録したか確認してください。

```bash
curl -X POST https://your-worker.workers.dev/oauth/setup \
  -H "Content-Type: application/json" \
  -d '{"client_id":"...","client_secret":"...","redirect_uris":["..."]}'
```

### `Hatena account not linked` エラー

`start_hatena_oauth`ツールでまずはてなブログとの連携を完了してください。

### PKCE検証エラー

ChatGPTクライアントが正しく`code_verifier`を送信しているか確認してください。

### JWT検証エラー

- `JWT_PUBLIC_KEY`と`JWT_PRIVATE_KEY`が正しく設定されているか確認
- 両方の鍵の`kid`（Key ID）が一致しているか確認

---

## ChatGPT Connectors でのセットアップ時の注意点（実機確認済み）

実際にChatGPT ConnectorsでMCPとして登録した際にハマった点をまとめます。

### 1. MCPのURLは `/mcp` まで含める

ChatGPT ConnectorsにURLを登録する際は、ルートURLではなく `/mcp` エンドポイントを指定してください。

- ❌ `https://your-worker.workers.dev`
- ✅ `https://your-worker.workers.dev/mcp`

### 2. ChatGPTのredirect URIはone-shot生成される

ChatGPT Connectorsは登録時に `https://chatgpt.com/connector/oauth/<ランダムID>` という固有のredirect URIを生成します。このURLを `OAUTH_REDIRECT_URIS` に追加し、`/oauth/setup` を再実行する必要があります。

手順：
1. ChatGPT ConnectorsでMCPを登録 → 表示されたredirect URIをコピー
2. `wrangler secret put OAUTH_REDIRECT_URIS` で既存のURIにカンマ区切りで追加
3. `/oauth/setup` を再度POSTして登録情報を更新

```bash
# PowerShellの場合
Invoke-RestMethod -Method POST -Uri "https://your-worker.workers.dev/oauth/setup" `
  -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $SETUP_SECRET" } `
  -Body '{"client_id":"...","client_secret":"...","redirect_uris":["https://chatgpt.com/connector/oauth/<your-id>","https://claude.ai/api/mcp/auth_callback","https://claude.com/api/mcp/auth_callback"]}'
```

### 3. redirect URIを変更したら `/oauth/setup` の再実行が必要

`OAUTH_REDIRECT_URIS` を更新しても、Durable Objectsに保存されているクライアント登録情報は自動更新されません。必ず `/oauth/setup` を再度POSTして反映させてください。

### 4. はてなOAuthアプリの権限設定に注意

はてなのOAuthアプリ登録時、`read_private` と `write_private` の両方にチェックが必要です。`read_public` / `write_public` だけでは非公開記事の操作ができず、またブログ投稿に失敗する場合があります。

### 5. Claude.aiでの接続時はClient ID / Secretの入力欄が隠れている

Claude.aiのIntegrations設定でMCPを登録する際、`OAUTH_CLIENT_ID` と `OAUTH_CLIENT_SECRET` の入力欄がデフォルトでは表示されていません。詳細設定を展開するか、OAuth設定のオプション項目を確認してください。これらを設定しないと認証が通りません。

なお、Claude.aiのredirect URI（`https://claude.ai/api/mcp/auth_callback` および `https://claude.com/api/mcp/auth_callback`）はChatGPTと異なりone-shotではなく固定のため、最初から `OAUTH_REDIRECT_URIS` に含めておけば `/oauth/setup` の再実行は不要です。

### 6. Durable ObjectsはFreeプランでは `new_sqlite_classes` が必要

`wrangler.toml` のmigrationsで `new_classes` を使うとFreeプランではデプロイエラーになります。`new_sqlite_classes` に変更してください。

```toml
# ❌ Freeプランでは動かない
[[migrations]]
tag = "v1"
new_classes = ["UserDurableObject", "OAuthStateDurableObject"]

# ✅ Freeプランでも動く
[[migrations]]
tag = "v1"
new_sqlite_classes = ["UserDurableObject", "OAuthStateDurableObject"]
```

## 環境変数リファレンス

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `HATENA_CONSUMER_KEY` | はてなOAuthアプリのConsumer Key | `abcd1234...` |
| `HATENA_CONSUMER_SECRET` | はてなOAuthアプリのConsumer Secret | `xyz789...` |
| `OAUTH_ISSUER` | OAuthトークンの発行者URL | `https://your-worker.workers.dev` |
| `OAUTH_CLIENT_ID` | MCPクライアントID | UUID形式 |
| `OAUTH_CLIENT_SECRET` | MCPクライアントシークレット | ランダム文字列 |
| `OAUTH_REDIRECT_URIS` | リダイレクトURI（カンマ区切り） | `https://chatgpt.com/... , https://claude.ai/api/mcp/auth_callback` |
| `JWT_PUBLIC_KEY` | JWT検証用公開鍵（JWK形式） | JSON文字列 |
| `JWT_PRIVATE_KEY` | JWT署名用秘密鍵（JWK形式） | JSON文字列 |
| `SETUP_SECRET` | `/oauth/setup` 用の管理者シークレット（Bearerトークン） | ランダム長文字列 |

## API エンドポイント一覧

### Discovery Endpoints

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| `/.well-known/oauth-protected-resource` | GET | MCP OAuthリソースメタデータ |
| `/.well-known/oauth-authorization-server` | GET | OAuth認可サーバーメタデータ |

### OAuth Endpoints

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| `/oauth/authorize` | GET | OAuth認可エンドポイント（PKCE対応） |
| `/oauth/token` | POST | トークン取得（認可コード→JWT） |
| `/oauth/jwks` | GET | 公開鍵セット（JWK Set） |
| `/oauth/setup` | POST | クライアント登録（初回のみ） |

### MCP Endpoint

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| `/mcp` | POST | MCP JSON-RPCエンドポイント（Bearer認証必須） |

### Callback Endpoint

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| `/hatena/oauth/callback` | GET | はてなOAuthコールバック |

## コントリビューション

プルリクエストを歓迎します！大きな変更の場合は、まずissueを開いて変更内容を議論してください。

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 関連リンク

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Hatena Blog AtomPub API](https://developer.hatena.ne.jp/ja/documents/blog/apis/atom)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
