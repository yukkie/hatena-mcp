# AGENTS.md

## Goal

このリポジトリの Hatena MCP Server を、手元で理解しながらセットアップし、最終的に ChatGPT などの MCP クライアントから使える状態にする。

## Current Understanding

- この実装は `Cloudflare Workers + Durable Objects` 前提
- ローカル開発は `wrangler dev --local` で可能
- ただし MCP クライアント連携と OAuth コールバックには公開 URL が必要なので、実利用には Cloudflare へのデプロイが必要
- はてな側の OAuth 1.0a アプリ登録も必要

## Setup Plan

1. 仕組みの把握
   - この MCP の役割、Cloudflare が必要な理由、ローカルでできることと本番でしかできないことを整理する
2. ローカル前提の準備
   - `bun install`
   - `.dev.vars` を `.dev.vars.example` ベースで作成
   - `bun run setup` で JWT 鍵と OAuth クライアント情報を生成
3. 外部サービス準備
   - Cloudflare アカウントを用意
   - Hatena OAuth アプリを登録
   - callback URL を `https://<worker-domain>/hatena/oauth/callback` に合わせる
4. Cloudflare 側の反映
   - `wrangler` にログイン
   - 必要な secrets / vars を設定
   - `bun run deploy` で Worker をデプロイ
5. MCP OAuth 初期登録
   - `/oauth/setup` に `SETUP_SECRET` 付きで初回 client 登録を実行
6. MCP クライアント接続
   - ChatGPT または Claude に `/mcp` エンドポイントを OAuth 設定付きで登録
7. 動作確認
   - OAuth 認可が通るか確認
   - Hatena のブログ一覧取得や記事作成ツールを試す

## Immediate Next Steps

1. README を人間向けに噛み砕いて、セットアップ手順を日本語で短く再整理する
2. このマシンで不足しているものを確認する
   - `bun`
   - `wrangler`
   - Cloudflare ログイン状態
3. `.dev.vars` 作成方針を決める

## Notes

- 現状コードでは Cloudflare 以外のホスティング先は想定されていない
- `Durable Objects` を使っているため、単純な静的ホスティングや普通の Node サーバ置き換えではそのまま動かない
- まずは「ローカルで起動確認」まで進め、その後に「Cloudflare へ公開」の順で進めるのが安全
