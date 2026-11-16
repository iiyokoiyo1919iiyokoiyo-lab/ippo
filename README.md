# IppO — 仮想ブラウザ搭載のSNS

投稿・返信・いいね・リポスト・フォロー・検索ができるミニブログ型SNSです。
投稿内のリンクは **サーバー側の使い捨てブラウザ（仮想環境）** で開かれ、利用者の端末にはサイトの画面だけが届きます。

## ローカルで起動

```bash
npm install
npx playwright install chromium   # 初回のみ
npm start                          # http://localhost:3000
```

Node.js 22.5 以上が必要です（組み込みの SQLite を使用）。

## 公開する

仮想ブラウザは Chromium を動かすため、**メモリ 2GB 程度のサーバー** と **永続ディスク**（SQLite 用）が必要です。
静的ホスティング（GitHub Pages / Vercel / Netlify）では動きません。

### 方法A: Railway（スマホのブラウザだけで公開できる）

1. https://railway.com を開き「Login」→ GitHub でログイン
2. 「New Project」→「Deploy from GitHub repo」→ `ippo` を選ぶ（自動でビルドが始まる）
3. 「+ Create」→「Volume」→ `ippo` サービスに取り付け、マウント先を `/data` にする
4. `ippo` サービス →「Settings」→「Networking」→「Generate Domain」（ポートを聞かれたら `3000`）
5. 表示された `https://〜.up.railway.app` を開く

### 方法B: Fly.io（パソコンから・東京リージョン）

```bash
fly auth login
fly launch --copy-config --no-deploy   # アプリ名を聞かれたら好きな名前に
fly volumes create ippo_data --size 1 --region nrt
fly deploy
```

`https://<アプリ名>.fly.dev` で公開されます。HTTPS は自動です。

### 方法C: VPS（さくら・ConoHa・Lightsail など）+ Docker

```bash
docker compose up -d --build
```

その前段に Caddy などを置いて HTTPS 化してください（例: `Caddyfile` に `ippo.example.com { reverse_proxy localhost:3000 }`）。
HTTPS で配信すると、ログイン Cookie に自動で `Secure` が付きます。

### 独自ドメイン

Fly.io なら `fly certs add ippo.example.com` を実行し、表示された DNS レコードをドメイン側に設定します。

## 本番向けに入っている対策

- セキュリティヘッダー（CSP・X-Frame-Options・HSTS など）
- ログイン/登録・投稿のレート制限、セッションの有効期限（30日）
- 仮想ブラウザ: 1ユーザー1セッション、同時起動数の上限、10分の制限時間、内部ネットワーク宛通信の遮断、ダウンロード無効
- 非 root ユーザーでの実行、ヘルスチェック（`/healthz`）

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PORT` | 3000 | 待ち受けポート |
| `DB_PATH` | `./ippo.db`（Docker では `/data/ippo.db`） | SQLite ファイル |
| `VB_MAX_SESSIONS` | 4 | 仮想ブラウザの同時起動数（メモリ 2GB で 3〜4 が目安） |
| `VB_TTL_MS` | 600000 | 1セッションの制限時間 |
| `TRUST_PROXY` | 1 | 前段にあるリバースプロキシの段数 |
| `VB_ALLOW_PRIVATE` | – | `1` で内部アドレスを許可（**開発時のみ。本番では絶対に設定しない**） |

## 公開前に検討したいこと

- **利用規約・プライバシーポリシー・通報窓口**（SNS を一般公開する場合はほぼ必須）
- 仮想ブラウザは外部サイトへのアクセスがサーバーの IP から行われるため、悪用対策（利用者制限・ログ保存）
- DNS リバインディング対策として、ブラウザの通信を内部アドレス遮断済みのプロキシ経由にする
- 利用者が増えたら仮想ブラウザを別サーバーに分離し、DB を PostgreSQL に移行
