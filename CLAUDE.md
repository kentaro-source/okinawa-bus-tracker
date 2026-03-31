# バスどこ沖縄 - プロジェクト方針

## 概要
沖縄のバスリアルタイム位置情報アプリ（PWA + TWA）
- Package ID: `com.busdoko.okinawa`
- デプロイ: Cloudflare Pages (`okinawa-bus.pages.dev`)
- データソース: busnavi-okinawa.com API
- ビルド: `npm run build` → `npx wrangler pages deploy dist --project-name=okinawa-bus --branch=main --commit-dirty=true`
- 県外観光客が主要ターゲット。Googleマップで乗換案内→このアプリで遅延確認→地図でバス停へ、の導線。

## 技術スタック
- React + Vite（SPA）
- Cloudflare Pages + Functions（APIプロキシ）
- PWA対応（TWA含む）

## アーキテクチャ
- `src/api.js` — バスナビ沖縄APIとの通信、バスデータ加工。同時リクエスト5並列制限。
- `src/App.jsx` — メイン画面。出発/行先選択、バス一覧表示、45秒自動更新。
- `src/BusList.jsx` — バスカード表示。走行中/未出発のグループ分け。
- `src/StationSelector.jsx` — バス停選択UI。全路線スキャンでキャッシュ構築（24時間TTL）。
- `functions/api/` — Cloudflare Functionsプロキシ（CORS回避）。

## API仕様
- ベースURL: `busnavi-okinawa.com`（Cloudflare Functions経由で `/api/*` にプロキシ）
- 主要エンドポイント: GetRouteList, GetCoursesGroup, GetStations, GetBusLocation
- バス停キャッシュ: localStorage `bus-tracker-station-cache-v2`（全路線の全停留所を集約）

## 主要な設計判断
- 全プロジェクトPWA + TWA統一方針（修正はサイトデプロイのみで反映）
- デフォルト: 出発=那覇空港、目的地=那覇バスターミナル（路線が多く初回表示のインパクト重視）
- バス停選択はクイックアクセス＋お気に入りのみ（一覧表示なし、検索で絞り込み）
- バックエンドにSupabase利用可能

## コーディング規約
- 日本語コメント推奨（ユーザーが日本語話者）
- console.warnでAPI失敗を記録（catchで握りつぶさない）
- ETAは「定刻＋遅延」で計算。始発停（OrderNo ≤ 2）の遅延データは信頼しない。
- 未出発バスは定刻過ぎでも消さない（遅延表示して残す）

## UI方針
- 誤解を招く表現は避ける（例: 「最速」は到着順を保証できないため使わない）
- Googleマップ連携: バス停名で検索リンク（座標ではなく名前ベース）
- 走行中バスを上、未出発を下にグループ表示

## 主要バス停（クイックアクセス）
那覇バスターミナル / 国際通り入口 / アメリカンビレッジ / 県庁北口 / イオンモール沖縄ライカム / 普天間 / 具志川バスターミナル / おもろまち駅前

## ロードマップ
1. 自分で使い込む（2026年3月末〜）
2. 知り合いに配布テスト（4月上旬・新学期）
3. 時刻表の事前表示（APIリアルタイムデータは出発数分前にしか出ない → 時刻表APIで補完）
4. LINE bot化（バス情報＋要望受付）
5. 多言語対応（日中韓英）
6. 2月: プロ野球キャンプ地バス停を季節追加

## 収益化・公開方針
- 当面は広告なし・無料
- Google Play公開前にモバイルクリエイト社にデータ利用許諾を取る
- 公益性を重視、筋を通してから拡大

## API バス停名の注意点
- 那覇空港の実際のバス停名は「国内線旅客ターミナル前」「国際線旅客ターミナル前」
- 「那覇空港」という名前のバス停は存在しない → エイリアスで対応
- バス停名に括弧で方向表記が含まれる（例: `軍桟橋前（那覇空港→旭橋方面）`）→ マッチング時は括弧内を除外
- `matchStation()` 関数で統一的にマッチング（getBaseName + エイリアス）

## TWA（Android アプリ）
- Package ID: `com.busdoko.okinawa`
- PWABuilderで生成、assetlinks.json設置済み
- APK再ビルド不要（サイトデプロイで即反映）
- 妻のアプリ含め今後は全プロジェクトPWA+TWA統一方針

## 既知の課題
- 読谷バスターミナルが検索に出ない（API側の駅名を要確認）
- バス停キャッシュがない初回は全路線スキャンに時間がかかる
- Cloudflare Pages無料枠: 1日10万リクエスト（デプロイ多い日に超過する可能性）
- バスナビ沖縄API対象外の路線バス会社（組み込み検討）:
  - 東京バス（TK02、ウミカジライナー等）— GTFS-RT提供の可能性あり
  - カリー観光（北谷ライナー、美ら海ライナー等）— GTFS静的データ公開済み
  - やんばる急行バス（那覇空港〜美ら海水族館〜運天港）
  - 沖縄エアポートシャトル（空港〜北部リゾート）
  - ※国頭村営バス・うるま市有償バスは対象外（ローカル限定）
- 未出発バスのAPI登録タイミングが出発直前（数分前）→ 始発停のみ事前表示できない
  - 途中停留所は走行中バスが見えるので問題なし
  - → 始発停のみ時刻表API（Timetable/TimeAndApproach）で補完予定
- ETA表示は出発地到着基準（目的地基準だと通過済み＝乗れないバスが表示される問題）
  - 始発停では全バスが通過済みで何も出ない → 時刻表機能で対応予定
- 遅延データはバスが停留所通過時に更新される → 渋滞区間に入ると一気に遅延が積み上がる
- 祝日便（例: 120番）は経路が変わる場合あり。YoubiKbnで曜日判定しているが祝日判定は未実装
- ルートお気に入り機能あり（localStorage `bus-tracker-route-favorites`、最大5件）
- 経由地表示あり（VIA_LANDMARKS: 久茂地・牧志・県庁北口等の主要バス停を自動抽出）
- AllStationsは路線の全コースバリエーション共通。個別バスが実際に停まる停留所とは異なる場合がある
  - 例: 23番は複数コースがあり、泊高橋を通るコースと通らないコースがある
  - PassedSchedulesも個別バスのコースを完全には反映しない場合がある
  - 現状はstopsAwayの正負で通過判定しているが、本質的にはコースバリエーション問題
- Service Workerはnetwork-first戦略（cache-firstだとデプロイが反映されない問題があった）
- 接近情報API（Approach）は出発地に向かう全バスを返す（目的地フィルタなし）→ getBusesBetweenでフィルタ
- 行先表示は個別バスのPassedSchedules最終停留所を使用（group.YukisakiNameは不正確な場合がある）
- 空港バス停名の内部統一: 那覇空港/国内線旅客ターミナル前/国際線旅客ターミナル前 → 旅客ターミナル前
- Approach APIの制限: 全路線のバスを返すわけではない（例: 屋富祖で63番・24番が返らない）
  - BusLocation APIで補完しているが、バス停キャッシュに路線がないとクエリされない
  - 対策: 出発地＋目的地の両方のキャッシュから路線を取得（デュアルキャッシュ参照）
- matchStationの部分一致問題: `includes`だと「屋富祖」が「屋富祖入口」にマッチしてしまう
  - EXCLUDED_SUFFIXES（通り、入口、団地、小学校等）で除外判定を追加
- バス消失問題（走行中バスが一時的に消える）:
  - BusLocation APIが停留所間移動中にバスを返さないことがある
  - 1サイクル保持（prevBusesRef + _retainedフラグ）で瞬断防止
  - 45秒間隔で2サイクル以上消える場合は対応できない（未解決）
- ETA遅延比率は試行して撤回。同じバス停・同じ残り停留所でも路線ごとにETAが異なる問題が発生
  - 現在の計算: actualArrival + remainingScheduledMinutes - now（シンプルな加算方式）
- モーダル検索: キーボード表示時に下にずれる問題 → align-items: flex-start に変更
- バス停キャッシュ: 失敗路線が3超の場合TTLを1時間に短縮（リトライ3回、並列数2で安定化）
- 逆方向バスフィルタ: 行先が出発地と一致するバスを除外（例: 那覇BT→泊高橋で那覇BT行きを除外）
- 時刻表取得数: 50件取得→フィルタ後に5本に制限（繁忙ターミナル対応）

## コミュニケーション方針
- やり取りで得た方針・学びはこのCLAUDE.mdに自動追記する（PC間共有のため）
- 技術用語（PR、Git等）は使わず日本語で結果だけ伝える
- 簡潔に、余計な説明はしない

## Git運用
- ブランチ: `claude/intelligent-mirzakhani`
- デプロイ: `npx wrangler pages deploy dist --project-name=okinawa-bus --branch=main --commit-dirty=true`
- PR: https://github.com/kentaro-source/okinawa-bus-tracker/pull/1
- Git設定: kentaro-source / kentaro@kawagoe-sangyoui.com
- **重要: 修正後は必ずコミット→push→ビルド→デプロイの順で実行すること（PC間の同期漏れ防止）**
