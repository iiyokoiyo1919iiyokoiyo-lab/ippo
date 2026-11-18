# IppO 開発メモ

## 新キャラ・新クエストを追加するとき (必ずセットで行う)
新キャラ (ガチャのキャラ) や期間限定クエストを追加するたびに、次の 3 つを必ずセットで行うこと。

1. **カードゲームの設定** (`cards.js`)
   - 新キャラ: `CARD_LIST` に追加し、登場時刻を `RELEASES` に入れる (ピックアップがあれば `PICKUPS` も)
   - 新クエスト: `QUESTS` に追加する (開始・終了の時刻、敵、報酬)
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
- 高難易度クエスト (`QUESTS` の `hard: true`) も同じ: 敵は先を読む CPU、`boost` は `node tools/tune_oni.js` の `quest:<id>` の結果を入れる

## そのほか
- 既存の機能を消さない・データベースの構造を勝手に変えない (表の追加・列の追加は `db.migrate` で)・認証やアクセス制御を弱めない
- 利用者の書いた文字は必ずエスケープして表示する (innerHTML に生のまま入れない)
- コミットメッセージにモデル名を書かない
