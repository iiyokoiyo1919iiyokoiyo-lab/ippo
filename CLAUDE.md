# IppO 開発メモ

## 新キャラ・新クエストを追加するとき (必ずセットで行う)
新キャラ (ガチャのキャラ) や期間限定クエストを追加するたびに、次の 3 つを必ずセットで行うこと。

1. **カードゲームの設定** (`cards.js`)
   - 新キャラ: `CARD_LIST` に追加し、登場時刻を `RELEASES` に入れる (ピックアップがあれば `PICKUPS` も)
   - 新クエスト: `QUESTS` に追加する (開始・終了の時刻、敵、報酬)
   - 期間限定クエストには固有の戦闘背景を付ける: `tools/make_quest_bg.js` に絵を足して `node tools/make_quest_bg.js` → `public/bg/<名前>.svg`、`QUESTS` の `bg` に名前を書く
   - たくさんまとめて追加するときは `BULK_RELEASES` に入れる (お知らせ・バナー・公式の投稿が 1 回にまとまる)。絵は `tools/new_chars_2026_11.json` のような設定から `cards-art.js` の `GEN` で描ける
2. **ドパバナー (告知画像) を作る**
   - `node tools/make_banners.js` を実行すると、設定から `public/banners/char-<id>.jpg` / `public/banners/quest-<id>.jpg` ができる
   - できた画像を開いて、文字が読めること・キャラが見えることを確認してからコミットする (作り直しは `--force`)
3. **公式アカウント (@IppO_official) の投稿**
   - `official.js` が設定から自動で予定を作り、時刻になったらドパバナーの画像つきで投稿する (登場・開始、終了の予告、終了)
   - アップデート情報の文章は `official.js` の `UPDATES` に追加する (key は変えない。at〜until の間に 1 回だけ投稿)
   - ホームとミニゲームの画面の告知バナーにも、同じ画像が自動で出る

## ガチャの告知 (セール・ピックアップ・確率アップ)
- `official.js` の `GACHA_NOTICES` に `{ id, at, until }` を足すと、その時点のセール・ピックアップ・確率アップを設定から集めて、
  公式アカウントの投稿 (ドパバナーつき) とアプリの告知バナー (until まで) を自動で作る
- 足したら `node tools/make_banners.js` で `public/banners/gacha-<id>.jpg` を作り、画像を開いて確認してからコミットする

## CPU 戦「鬼難」の強さ
- `cards.js` の `ONI_DECKS` の boost は「Lv18 の SSR・MR デッキで勝率 25% (誤差 5% 以内)」になるよう `node tools/tune_oni.js` で決めた
- カードの能力・わざ・新キャラなど、対戦の強さが変わる変更をしたら、`node tools/tune_oni.js` で測り直して boost を更新する
- 高難易度クエストは、1 番目・2 番目にクリアした人を公式アカウントが自動で表彰する (`cards.js` の `QUEST_AWARD_RANKS`、文章は `official.js` の `ctx.officialAward`)
- クエストの `titles: { 1: '称号名', 2: ... }` で、その順位でクリアした人に称号を贈る (表 `user_titles`。プロフィールと対戦の名前の横に出る)
- 高難易度クエストでは、開始 30 分後からアイテム (`cards.js` の `ITEMS`: 回復薬・全回復薬・アイスティー) をコインで買って使える
- 高難易度クエストの報酬キャラは勝つたびに 1 枚もらえ、25 枚で LR に昇格 (`cards.js` の `LR_PROMOTE`。能力 +35%・虹色のデザイン)
- 高難易度クエスト (`QUESTS` の `hard: true`) も同じ: 敵は先を読む CPU、`boost` は `node tools/tune_oni.js` の `quest:<id>` の結果を入れる

## ブリードモンスターズ (monster.js・public/games/monster/)
- いまはテスト中: 遊べるのは環境変数 `MON_TESTERS` のユーザーだけ (未設定なら RCN413。`*` で全員に解放)。ほかの人は API・接続とも 403、一覧にも出ない
- IppO の中の iframe で開くミニアプリ (`#/monster` → `/games/monster/`)。コインはぶんぼうぐバトラーズと共用 (`ctx.cbCoins`)
- 技は `monster.js` の `SKILL_LIST` に足す (コマンドは全部ちがう並びにする。重なると起動時にエラー)。新技は `release` の時刻から使える
- 新技は、それを持った公式の種モンを `OFFICIAL_STUDS` に足して配る (登場時刻つき)。だれでも種付け料で配合できる
- メスモンスターショップ: 毎朝 7 時に 6 体 (B 3・A 2・S 1)・先着順・1 人 1 日 1 体 (`SHOP_LEVELS` / `SHOP_RANKS`)。共通の種モンは属性ごとに 1 体・種付け料 30 (`COMMON_STUDS`)
- 突然変異: データと計算は `monster-mutation.js` (変異の一覧 `MUTATIONS`・相乗効果 `SYNERGIES`・確率 `DEFAULT_CONFIG`。環境変数 `MON_MUTATION_CONFIG` で上書き。基本 10%・上限 12%)。変異は id を変えずに足していく
  - 未発見の変異は画面に一切出さない (変異の一覧をクライアントに送らない・絵のコードにも名前を入れない)。発見の記録 `mon_discoveries` は書きかえ・削除できない
  - 変異の能力は保存した能力値に足さず、表示とバトルで計算する (配合で子に渡すのは変異なしの能力)。R 以上の変異で生まれたら市場価値 1000 (`init_score`。種モンの条件には数えない)
  - テストで必ず変異させるときは `MON_MUTATION_FORCE=1` (本番では設定しない)
- セリは毎時 5 分 (テストは `MON_AUCTION_TEST=1` と `POST /api/mon/auction/test-start`)

## そのほか
- 既存の機能を消さない・データベースの構造を勝手に変えない (表の追加・列の追加は `db.migrate` で)・認証やアクセス制御を弱めない
- 利用者の書いた文字は必ずエスケープして表示する (innerHTML に生のまま入れない)
- コミットメッセージにモデル名を書かない
