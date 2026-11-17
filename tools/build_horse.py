#!/usr/bin/env python3
"""ミニゲーム「117万分の1 競走馬版」を IppO 用に組み立てる。

元のゲーム (iiyokoiyo1919iiyokoiyo-lab/- の docs/index.html) から、次の 3 つを作る。
  public/games/horse/index.html … HTML と CSS (元のまま。Google Fonts・X のボタン・OFUSE のリンクだけ外す)
  public/games/horse/logic.js   … 生まれる処理 (確率・文章・統計)。元のコードをそのまま切り出す。サーバーも同じものを使う
  public/games/horse/game.js    … 画面・演出・カード・図鑑。保存先とシェアのところだけ IppO 用に書き換える
IppO とつなぐ処理は public/games/horse/ippo.js (手で書いたもの) にある。

使い方:
  git clone -b claude/net-version-support-sepna5 https://github.com/iiyokoiyo1919iiyokoiyo-lab/- /tmp/horse
  python3 tools/build_horse.py /tmp/horse/docs/index.html

書き換える場所はすべて「元の文字列がちょうど 1 回出てくること」を確かめてから置き換えるので、
元のゲームが更新されて場所が変わったときは、黙って壊れずにエラーで止まる。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'games', 'horse')


def once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        sys.exit(f'[build_horse] 「{label}」の場所が {n} 回見つかりました (1 回のはず)。元のゲームが変わった可能性があります')
    return s.replace(old, new)


def cut(s, start, end, label):
    """start から end の手前までを取り出す (start・end はちょうど 1 回)"""
    for m in (start, end):
        if s.count(m) != 1:
            sys.exit(f'[build_horse] 「{label}」の目印 {m[:40]!r} が 1 回ではありません')
    i, j = s.index(start), s.index(end)
    if i >= j:
        sys.exit(f'[build_horse] 「{label}」の順番が正しくありません')
    return s[:i], s[i:j], s[j:]


def main(src_path):
    src = open(src_path, encoding='utf-8').read()
    head_html, rest = src.split('<script>\n', 1)
    script, tail_html = rest.split('\n</script>', 1)
    if '<script' in head_html or '<script' in tail_html:
        sys.exit('[build_horse] script が 1 つではありません')

    # ---------- logic.js: 生まれる処理 (元のコードのまま) ----------
    mark = '/* ---------- 効果音(Web Audioで合成。音源ファイルは使わない) ---------- */'
    if script.count(mark) != 1:
        sys.exit('[build_horse] 生まれる処理の終わりが見つかりません')
    logic, game = script[:script.index(mark)], script[script.index(mark):]
    # rarityOf (レア度の決め方) もサーバーで使うので logic.js へ移す (中身は変えない)
    m = re.search(r'\nfunction rarityOf\(life\)\{\n.*?\n\}\n', game, re.S)
    if not m or game.count('function rarityOf(') != 1:
        sys.exit('[build_horse] rarityOf が見つかりません')
    rarity_fn = m.group(0)
    game = game.replace(rarity_fn, '\n')
    logic = ('// 117万分の1 競走馬版: 生まれる処理 (tools/build_horse.py が元のゲームから切り出したもの。手で編集しない)\n'
             '// ブラウザとサーバー (horse.js) の両方で、まったく同じこのコードを動かす\n'
             + logic.rstrip() + '\n' + rarity_fn)

    # ---------- game.js: 画面・演出 (保存先とシェアだけ IppO 用に) ----------
    # 結果画面: ニックネーム欄を外し (IppO のアカウント名で載せる)、X のボタンを「IppOでシェア」に
    game = once(game, '''      <div class="namerow nickrow"><label for="nick">ニックネーム</label><input id="nick" type="text" maxlength="12" autocomplete="nickname" placeholder="12文字まで"></div>\n''', '', 'ニックネーム欄')
    game = once(game, '''<a class="btn btn-x" id="btnX" href="https://x.com/intent/post" target="_blank" rel="noopener noreferrer"><span class="xlogo" aria-hidden="true">𝕏</span>でポストする</a>''',
                '''<button class="btn btn-ippo" id="btnX" type="button">IppOでシェア</button>''', '結果の X ボタン')

    # 応援 (OFUSE) のリンクは IppO では出さない
    game = once(game, '''      <a class="btn btn-support" id="btnSupport" href="https://ofuse.me/640dc097" target="_blank" rel="noopener noreferrer">🐴 この作者を応援する(OFUSE)</a>\n''', '', '結果の OFUSE リンク')

    # みんなの結果: Supabase → IppO の API とアカウント
    before, _old_net, after = cut(game, '/* ---------- みんなの結果(GitHub Pages 版: Supabase) ---------- */', '// 結果画面にも「みんなの結果」を出す', 'みんなの結果')
    game = before + open(os.path.join(ROOT, 'tools', 'horse_board.js'), encoding='utf-8').read().rstrip() + '\n\n' + after

    # 図鑑・実績: ログイン中は IppO のサーバーに保存 (ゲストは今までどおりこの端末に保存)
    game = once(game, 'function zSave(){ try { localStorage.setItem(ZKEY',
                'function zSave(){ if (IPPO.zSave()) return; try { localStorage.setItem(ZKEY', '図鑑の保存')

    # X でポスト → IppO でシェア (文章を作る関数はそのまま使う)
    game = once(game, '/* ---------- Xでポスト ---------- */', '/* ---------- IppOでシェア (文章は元の X 用と同じものを使う) ---------- */', 'X 見出し')
    game = once(game, "const PAGES_URL = 'https://iiyokoiyo1919iiyokoiyo-lab.github.io/-/';\n", '', 'PAGES_URL')
    game = once(game, "const SHARE_URL = /\\.github\\.io$/.test(location.hostname) ? location.origin + location.pathname : PAGES_URL;\n", '', 'SHARE_URL')
    game = re.sub(r"function xHref\(text\)\{[^\n]*\}\n", '', game, count=1)
    game = re.sub(r"function setX\(id, fn\)\{[^\n]*\}\n", 'function setX(id, fn){ const a = $(id); if (!a) return; a.onclick = () => IPPO.share(id, fn); }\n', game, count=1)
    if 'xHref' in game or 'IPPO.share(id, fn)' not in game:
        sys.exit('[build_horse] X の置き換えに失敗しました')

    # 起動: ログイン状態を確かめてから「みんなの結果」と図鑑を読み込む
    game = once(game.rstrip(), '\ninitNet();', '\nIPPO.start();', '起動')
    game = ('// 117万分の1 競走馬版: 画面・演出・カード・図鑑 (tools/build_horse.py が元のゲームから作ったもの。手で編集しない)\n'
            '// 元のゲームから変えたのは「みんなの結果」「図鑑の保存先」「シェア」だけ。IppO とのつなぎは ippo.js\n'
            + game.lstrip('\n') + '\n')

    # ---------- index.html ----------
    html = head_html
    # 外部フォントは読み込まない (端末の明朝体で表示)。GitHub Pages 用の OGP も外す
    html = once(html, '<link rel="preconnect" href="https://fonts.googleapis.com">\n', '', 'preconnect1')
    html = once(html, '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', '', 'preconnect2')
    html = re.sub(r'<link href="https://fonts\.googleapis\.com/[^"]*" rel="stylesheet">\n', '', html, count=1)
    html = re.sub(r'<meta (property="og:[^"]*"|name="twitter:[^"]*") content="[^"]*">\n', '', html)
    if 'fonts.googleapis' in html or 'og:' in html:
        sys.exit('[build_horse] フォント・OGP の削除に失敗しました')
    html = once(html, '</head>', '<link rel="stylesheet" href="ippo.css">\n</head>', 'head')
    html = once(html, '''<a class="btn btn-x" id="btnTenX" href="https://x.com/intent/post" target="_blank" rel="noopener noreferrer"><span class="xlogo" aria-hidden="true">𝕏</span>で10連の結果をポスト</a>''',
                '''<button class="btn btn-ippo" id="btnTenX" type="button">IppOで10連の結果をシェア</button>''', '10連の X ボタン')
    html = once(html, '''<a class="btn btn-x" id="btnAlbumX" href="https://x.com/intent/post" target="_blank" rel="noopener noreferrer"><span class="xlogo" aria-hidden="true">𝕏</span>で図鑑の記録をポスト</a>''',
                '''<button class="btn btn-ippo" id="btnAlbumX" type="button">IppOで図鑑の記録をシェア</button>''', '図鑑の X ボタン')
    html = once(html, '''  <a class="support-link small" href="https://ofuse.me/640dc097" target="_blank" rel="noopener noreferrer">🐴 このゲームを応援する(OFUSE)</a>\n''', '', 'はじめの画面の OFUSE リンク')
    if 'ofuse' in html.lower() or 'ofuse' in game.lower():
        sys.exit('[build_horse] OFUSE へのリンクが残っています')
    if 'x.com' in html or 'x.com' in game:
        sys.exit('[build_horse] X へのリンクが残っています')
    if '非公式' not in html:
        sys.exit('[build_horse] 「非公式のファン作品」の表記が見つかりません')
    html += '<script src="logic.js"></script>\n<script src="ippo.js"></script>\n<script src="game.js"></script>' + tail_html

    os.makedirs(OUT, exist_ok=True)
    for name, body in (('index.html', html), ('logic.js', logic), ('game.js', game)):
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            f.write(body)
        print(f'[build_horse] {name}: {len(body.encode()):,} bytes')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
