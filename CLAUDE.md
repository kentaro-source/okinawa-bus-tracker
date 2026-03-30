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
- 目的地指定時のETA表示は目的地到着基準（出発地到着基準だと始発駅通過済みバスが消える問題があったため）
- ルートお気に入り機能あり（localStorage `bus-tracker-route-favorites`、最大5件）
- 経由地表示あり（VIA_LANDMARKS: 久茂地・牧志・県庁北口等の主要バス停を自動抽出）

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
