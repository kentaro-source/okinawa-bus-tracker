# HANDOVER.md - バスどこ沖縄 引き継ぎ資料

最終更新: 2026-11-09（2件公開: (1)現場の信頼性対策: 取得の重なり防止・初回の空港路線絞り込み・ETA根拠とGPS鮮度の表示。(2)那覇空港の表示0件の修正: バスナビ側で空港のバス停名が『旅客ターミナル前』から『那覇空港（〜向け）』に改称され、旧称では駅マッチ・StationCorrectionとも照会できず、空港が絡む区間はリアルタイム・接近情報・時刻表の全経路が空になっていた。内部名を『那覇空港』に統一し旧称3種をエイリアス化（App.jsx の toInternalName/toDisplayName/mapsStopName、api.js の STATION_ALIASES と KNOWN_STATION_CODES に 那覇空港=1602、BusList.jsx の mapsStopName）。修正コミット 72b5d92、デプロイ 1d84b299。本番の既定画面（那覇空港→那覇バスターミナル）で 0件→5件 を確認済み。公開方法の注意: Muse環境では wrangler login のlocalhostコールバックが成立せず、Cloudflareダッシュボードの直接アップロードで公開した。ダッシュボードのアップロードでは functions フォルダは有効化されないため、functions/api/[[path]].js の内容を _worker.js（/api配下のみ処理し他はASSETSへ委譲）に変換して dist と一緒にアップロードする形で公開した（初回デプロイ 99bb74d1）。次回Muse側で公開する際はこの _worker.js 方式を使うこと。Cloudflareサインインは保存済みログイン（ユーザーが1Password Familiesボルトに現在のパスワードを保存）で成功するようになった（2026-11-09 18:47、初回で通過・手入力不要）。既知の軽微な問題: Timetable由来の120番カードで行き先文字列が『共同運行）（名護バスターミナル』のように途切れて表示される（Function側のTimetable解析由来、実用上の支障なし）。前回 2026-07-07: 全体調査で作成、デフォルト出発地を那覇空港に復元、調査用残骸26ファイル削除・.gitignore整備）

このファイルは、初見のAIセッションがこのファイルだけを読んで開発を継続できることを目的とする。
セッション終了時・大きな変更時に「実装済み機能」「既知のバグ」「残タスク」を必ず更新すること。

---

## 1. プロジェクトの目的

沖縄県のバスのリアルタイム位置・到着予測を表示するWebアプリ「バスどこ沖縄」（PWA + TWA）。

- 課題: 沖縄のバスは遅延が多く、時刻表だけでは「次に来るバスがどれか」わからない
- 解決: 出発バス停→目的バス停を指定すると、直通バスの到着予測（ETA）・現在位置・遅延を一覧表示
- 主要ターゲット: 県外観光客。Googleマップで乗換検索→このアプリで遅延確認→地図でバス停へ、という導線
- 本格的な乗換案内（複数経路最適化）はスコープ外。直通バスのみ表示し、乗換はGoogle Mapsへのリンクで誘導
- 収益化はOTTOP賛助会員加入によるライセンス問題クリア後に広告導入予定（詳細はCLAUDE.md「収益化・公開方針」）
- 現況: 使い込み・配布テスト中（2026年4月〜）

## 2. 技術構成

### 言語・フレームワーク
- React 19 + Vite 8（JavaScript、SPA。TypeScriptなし）
- 依存は react / react-dom のみ（package.json）。UIライブラリ・状態管理ライブラリなし
- DB・バックエンドストレージなし（キャッシュは全てブラウザのlocalStorage）。CLAUDE.mdに「Supabase利用可能」とあるが現在未使用

### ホスティング・デプロイ
- Cloudflare Pages（プロジェクト名 `okinawa-bus`、URL: okinawa-bus.pages.dev）
- ビルド: `npm run build` → `dist/` 生成
- デプロイ: `npx wrangler pages deploy dist --project-name=okinawa-bus --branch=main --commit-dirty=true`
- 開発サーバ: `npm run dev`（ポート5173。vite.config.jsのproxy設定でAPI呼び出しを busnavi-okinawa.com に転送するため、Cloudflare Functionsなしでローカル動作する）
- Gitブランチ: `claude/intelligent-mirzakhani`（PR: https://github.com/kentaro-source/okinawa-bus-tracker/pull/1）
- 修正後は必ず コミット→push→ビルド→デプロイ の順で実行（PC間同期漏れ防止）

### ファイル構成（主要）
| ファイル | 役割 |
|---|---|
| `src/App.jsx` | メイン画面。出発/目的地選択、45秒自動更新、メニュー、お気に入り |
| `src/api.js` | バスナビ沖縄APIクライアント。バス加工・ETA計算・逆方向フィルタ・重複排除（987行、ロジックの中心） |
| `src/BusList.jsx` | バスカード表示。走行中/まもなく出発のグループ分け、他社バス統合 |
| `src/StationSelector.jsx` | バス停選択モーダル。全路線スキャンでバス停キャッシュ構築、ふりがな検索、GPS最寄り検索 |
| `src/otherBuses.js` | 他社バス（東京バス・やんばる急行・カリー観光・エアポートシャトル）の路線定義と時刻表検索 |
| `src/otherBusTimetable.js` | **自動生成ファイル**（scripts/build-timetable.cjs が gtfs_data/ から生成。直接編集しない。生成日2026-04-13） |
| `functions/api/[[path]].js` | Cloudflare Functions。APIプロキシ + HTMLパース + GTFS-RTデコード + LINE Bot Webhook |
| `scripts/build-timetable.cjs` | GTFSデータ→otherBusTimetable.js 生成スクリプト（`gtfs_data/<会社dir>/` が必要。gtfs_dataは.gitignore対象） |
| `public/sw.js` | Service Worker（network-first、APIはキャッシュ対象外。キャッシュ名 `bus-tracker-v4`） |
| `public/manifest.json` | PWAマニフェスト（名称「バスどこ沖縄」） |
| `docs/spec.md` | 初期の要求仕様書（歴史的資料。現状はこのHANDOVERが正） |

### 外部サービス・API
1. **バスナビ沖縄API**（busnavi-okinawa.com、モバイルクリエイト社）— メイン4社（琉球バス交通・那覇バス・沖縄バス・東陽バス）のリアルタイムデータ源
   - 認証・APIキー不要。`X-Requested-With: XMLHttpRequest` ヘッダ必須（プロキシが付与）
   - フロントは全て `/api/*` 経由（本番=Cloudflare Functions、開発=Viteプロキシ）
   - エンドポイント（functions/api/[[path]].js 実装）:
     - `GetRouteList` — 全路線一覧（Locationページの`<option>`をHTMLパース）
     - `GetCoursesGroup` / `GetCourses` / `GetStations` / `BusLocation` — `/top/Location/*` への素通しプロキシ（※GetBusLocationではなく`BusLocation`）
     - `Approach?stationCode=` — 接近情報（HTML→JSONパース。レスポンスに時刻表照会用の`stationSid`を含む）
     - `StationCorrection?stationName=` — バス停名→StationCode解決
     - `Timetable?stationSid=&busStopCode=` — バス停の全路線時刻表（HTML→JSONパース、曜日判定・現時刻フィルタ付き、5分キャッシュ）
2. **OTTOP GTFS-RT**（api.ottop.org）— 東京バスの車両位置・遅延
   - `TokyoBusPositions` エンドポイントで protobuf→JSON変換（agencyId `7011501003070`、APIキー不要で取得できている）
   - **ただしフロント側は現在無効化中**（後述）
3. **LINE Messaging API** — `/api/line-webhook` にWebhook実装済み（署名検証+バス停名→接近情報の応答+ヘルプ）
   - 環境変数 `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` を **Cloudflare Pagesの環境変数** に設定する必要あり（リポジトリ内に秘密情報は一切なし）
   - Cloudflare側に設定済みかどうかは未確認（コード上は未設定なら500を返す）
4. **Google Maps** — バス停検索・経路案内へのリンク（APIキー不使用、URLリンクのみ）
5. **Google Form** — 不具合報告フォーム（URLは App.jsx の `FEEDBACK_FORM_URL` にハードコード）

### localStorageキー
- `bus-tracker-route-list` — 全路線リスト（24時間TTL）
- `bus-tracker-station-cache-v2` — 全バス停キャッシュ（24時間TTL、スキャン失敗路線が4以上なら1時間に短縮）
- `bus-tracker-favorites` / `bus-tracker-route-favorites`（最大5件） / `bus-tracker-last-station` / `bus-tracker-last-dest`

## 3. 実装済み機能の一覧

### メイン4社バス（バスナビ沖縄API、リアルタイム）
- 出発→目的バス停間の直通バス一覧（BusLocation + Approach + Timetable の3系統をマージ）
- ETA計算: 出発地到着基準。`最終通過停の実到着時刻 + 残り定刻所要時間 - 現在時刻`（api.js processBuses）
- 遅延表示: 遅れのみ表示（早発非表示）、走行中かつ15停留所以内のみ（BusList.jsx）。始発停付近（OrderNo≤2）の遅延データは信頼せず使わない
- 逆方向フィルタ: `isCorrectDirection()`（api.js getBusesBetween内）に集約。GetStationsで確認した正方向コース終点名（confirmedRouteEnds）で全バス種別（リアルタイム/接近/時刻表）を検証
- 祝日便対応: PassedSchedulesが空でもPassages+AllStationsから位置・ETA・定刻を推定し「臨時」タグ付きで表示（isHolidayVariant）
- 始発停の時刻表補完: Approach APIレスポンスのstationSidで時刻表を常時照会し、接近情報にない路線をカバー
- SUPPLEMENTAL_DEPARTURES: Timetable API側に欠落している便を個別時刻で補完（現在: 那覇空港=stationCode 1602 の117番19本。API側に同時刻があればスキップ）
- 重複排除: 同路線±3分の定刻はリアルタイム側優先。時刻表エントリはフィルタ後最大5本
- 瞬断防止: 前回表示の走行中バスが消えた場合、最大2サイクル（90秒）保持（App.jsx prevBusesRef）
- 未出発バスは定刻過ぎでも消さず遅延表示で残す。未出発でETA 60分超は非表示

### 他社バス（GTFS静的時刻表ベース、src/otherBuses.js）
- 対象: 東京バスTK01〜TK06 / やんばる急行YKB888・YKB3T・YKB-HLT / カリー観光（北谷ライナー・パルコシティシャトル）/ 沖縄エアポートシャトル（OAS-APL・OAS-RSL・OAS-RSL-RP）
- 方向別時刻表（`会社名:路線:方向`キー、DIRECTION_METAで方向マッチング）、曜日ビットマスク、乗降制限flags（1=乗車専用、2=降車専用）
- 出発30分以内の便のみ、次便のない路線は非表示。各社への注記付きバスカード（東京バス→Google Maps遅延案内、やんばる急行→公式バスロケリンク、エアポートシャトル→Bus-Visionリンク）
- Google Maps経路リンク（出発→目的バス停、全社統一）

### バス停選択（StationSelector.jsx）
- 全路線スキャンによるバス停キャッシュ構築（5並列、失敗路線は並列2で最大3回リトライ）
- ふりがな検索: READING_ALIASES（地名・バス停名の読み仮名、実効53件）+ 他社バス停への手動yomigana付与 + ひらがな/カタカナ相互変換
- GPS最寄りバス停検索（上位5件、GPS精度±m表示、100m超で警告）
- 主要バス停クイックアクセス（POPULAR_STOPS、現在11件: 那覇バスターミナル/県庁北口/牧志/泊高橋/普天間/アメリカンビレッジ/イオンモール沖縄ライカム/具志川バスターミナル/コンベンションセンター前/名護バスターミナル/沖縄北ＩＣ）
- お気に入りバス停・お気に入りルート（出発→目的ペア、最大5件）
- APIバス停と他社バス停の路線情報マージ表示

### バス停名マッチング（api.js）
- `matchStation()`: 括弧内方向表記の除去（getBaseName）+ 前方/後方一致 + EXCLUDED_SUFFIXESで誤爆防止 + エイリアス
- 那覇空港エイリアス: 「那覇空港」→「旅客ターミナル前」（内部統一名）。「那覇空港」という名前のバス停はAPIに存在しない
- 那覇バスターミナル→「旭橋」「バスターミナル前」エイリアス

### UI・PWA
- 45秒自動更新、走行中/まもなく出発のグループ表示、色分け（🟢5分以内/🟡20分以内/🔴それ以降/⏳時刻不明）
- ETA根拠の明示（2026-11-09追加）: バスカードに根拠ラベル（リアルタイム／接近情報／時刻表）を表示。リアルタイムのバスはGPS時刻が2分以上古い場合に「📡 GPS ○分前」を表示し、10分以上では古い可能性を注記。時刻表由来のカードは「（時刻表）」表記に統一。更新に失敗した場合は、表示中の情報が何時点のものかをエラー表示に併記
- 取得の重なり防止（2026-11-09追加）: 取得連番で古い結果を破棄し、自動更新は取得実行中ならスキップ。バス停キャッシュ未構築時の初回取得は空港路線のみに絞り、初回表示を速くした（詳細は既知の問題9）
- 経由地表示: 出発〜目的間のVIA_LANDMARKS最大3件
- ハンバーガーメニュー（このアプリについて/使い方/トラブルシュート/不具合報告Googleフォーム/データ提供元クレジット）
- 出発⇄目的入れ替えボタン、Google乗換案内リンク、バス見つからない時の時間帯別ヒント
- PWA（manifest + Service Worker network-first）+ TWA（Package ID `com.busdoko.okinawa`、PWABuilder製、サイトデプロイで即反映）

### バックエンド（functions/api/[[path]].js）
- 上記API群のプロキシ・HTMLパース（詳細は「2. 技術構成」）
- LINE Bot Webhook（バス停名を送ると接近情報を返信。**フロントからは独立、要Cloudflare環境変数**）
- 東京バスGTFS-RT protobuf→JSON変換（`/api/TokyoBusPositions`、30秒キャッシュ）

## 4. 既知のバグ・未解決の問題

1. **東京バスGTFS-RTのフロント表示は一時停止中**（App.jsx:96-97でコメントアウト）
   - 理由: ルート方向判定・座標マッチングの精度不足。`getTokyoBusLive()`（otherBuses.js）とプロキシは実装済みのまま残っている
   - route_id 795/796（OTTOP内部ID）→TK01-TK06のマッピング未完
2. **那覇バスターミナルの出発時刻表が取得できない**（API制限、調査完了2026-04-20）
   - Approach APIが返すstationSidが「おりばA」（降車場）のため、Timetable APIで出発時刻表が取れない（到着のみ7路線）
   - 空港（出発15路線）・県庁北口（出発45路線）は正常。OTTOP GTFS static移行で解決可能
3. **祝日便問題**: 平日に祝日ダイヤ便が走っていたケースあり（120番で確認）。YoubiKbnフィルタは撤去済み（BusLocationが返すバスは実運行とみなす）が、根本原因・対策は保留
4. **Timetable APIの欠落便**: 117番空港発は実際19本中API側8本のみ→SUPPLEMENTAL_DEPARTURESで補完済み。他路線にも同様の欠落がある可能性（未調査）
5. **やんばる急行のOTTOP GTFS-RT対応は未確認**。カリー観光はリアルタイムなし、エアポートシャトルはBus-Vision（公開APIなし）
6. **LINE BotのCloudflare環境変数設定状態が未確認**（コードはデプロイ済みだが、LINE Developersのチャネル設定・Webhook URL登録・環境変数設定が済んでいるか不明）
7. **otherBusTimetable.jsの鮮度**: 2026-04-13生成。各社ダイヤ改正時は gtfs_data/ を更新して `node scripts/build-timetable.cjs` で再生成が必要（gtfs_dataは.gitignore対象のためPC間で共有されない。各社配布元から再取得可能）
8. カリー観光の石垣島路線（287/500）がTIMETABLEに含まれるが、路線定義（KARRY_ROUTES）は本島のみなので表示されない（実害なし、データの無駄のみ）
9. **初回起動（バス停キャッシュ未構築）はバス表示まで時間がかかる**（2026-11-09 対策実施済み）: getBusesBetweenがキャッシュなしだと全114路線をスキャンするため（1路線あたり2〜4リクエスト×5並列）、初回表示に1分以上かかることがある。さらにfetchBusesに再入防止がなく、45秒間隔の自動更新が前回未完了のまま重なるとリクエストが滞留する（ローカルdev検証時に実際に発生）。バス停キャッシュ構築後は絞り込みスキャンで速い。デフォルトが那覇空港だった旧実装（〜2026-03）から存在する挙動。2026-11-09の対策: （1）App.jsxに取得連番（fetchSeqRef）を導入し、古い取得結果は破棄。自動更新は取得実行中なら1回スキップ（fetchInFlightRef）。バス停変更時の取得は常に最新のものが優先される。（2）api.jsのgetBusesBetweenは、バス停キャッシュ自体が存在しない場合に限り全路線スキャンをやめ、AIRPORT_ROUTE_NUMBERSに絞る（デフォルト出発地＝那覇空港のため初回利用の大半をカバー）。キャッシュ構築済みで該当路線が無い場合は従来どおり全路線から探す。残件: StationSelector側のキャッシュ構築（全路線スキャン）自体は従来どおり時間がかかるが、これはバス停選択を開いたときだけの処理で、メイン一覧の初回表示は速くなった

### 解決済み（経緯の記録）
- **初回起動時のデフォルトが「那覇BT→那覇BT」で空表示になる問題**: 2026-07-07修正。コミットac77900（2026-03-30、ルートお気に入り追加）でデフォルト出発地が那覇空港から那覇BTに変わっていた（コミットメッセージに言及なし＝リファクタの巻き添えと判断）。出発=那覇空港（内部名: 旅客ターミナル前）に復元
- **リポジトリ直下の調査用残骸**: 2026-07-07に26ファイル削除（approach*.html×7、timetable.html、tmp_*.json×13、tmp_tk_gtfs.zip、tmp_ykb_*.pdf×2、化けたファイル名2件）。tmp_* は.gitignoreに追加済み

## 5. 残タスクと次に着手すべきこと

### 次に着手すべき（優先度順の提案）
1. **LINE Bot の本番化**（ロードマップ「LINE bot化」の続き）— Webhookコードは実装済み。残り: LINE Developersチャネル作成→Cloudflare Pages環境変数設定→Webhook URL登録→動作確認→要望受付機能の追加検討
2. **2路線並行表示** — メニュー「このアプリについて」で予告済みの機能（出発・目的地ペアを2組同時表示、乗り過ごし・途中乗換の判断支援）。未着手

### ロードマップ（CLAUDE.mdより、未着手）
- 多言語対応(日中韓英)
- プロ野球キャンプ地バス停の季節クイックアクセス（毎年2月）
- OTTOP API全面移行（バスナビ沖縄API依存の解消→広告ライセンス問題クリア）。ただしメイン4社のGTFS-RTはOTTOPに無い（2026-04確認）ため当面併用
- 東京バスGTFS-RT表示の再有効化（route_idマッピング完成＋方向判定改善後）

### 保守メモ
- 修正フロー: コミット→push→`npm run build`→`npx wrangler pages deploy dist --project-name=okinawa-bus --branch=main --commit-dirty=true`
- 他社バスの路線定義（otherBuses.js）を変更する際は、バス停名をGTFS時刻表（otherBusTimetable.js）のキーと完全一致させること（漏れると検索に出ない）
- UI文言は誤解を招く表現を避ける（「最速」等は使わない）。詳細方針はCLAUDE.md参照
- 調査用の一時ファイルはリポジトリ直下に置かない（scratchpadを使う）。`tmp_*`・`gtfs_data/`・`.claude/launch.json`・`.claude/worktrees/` は.gitignore済み
