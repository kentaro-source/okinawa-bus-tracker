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
- 使い込み・配布テスト中（2026年4月〜）
- LINE bot化（バス情報＋要望受付）
- 多言語対応（日中韓英）
- プロ野球キャンプ地バス停を季節追加（2月）

## 収益化・公開方針
- OTTOP（NPO）賛助会員（年3,000円）加入予定 → CC BY 4.0で広告OK
- OTTOP APIで全バス会社のデータを取得できれば、バスナビ沖縄API（モバイルクリエイト社）への依存を解消
- モバイルクリエイト社APIを使う限りは広告付けにくい（データ利用許諾が不明確）
- OTTOP全面移行が実現すればライセンス問題クリア → 広告導入可能
- 公益性を重視、筋を通してから拡大

## OTTOP移行計画
- OTTOP API: swagger.ottop.org（APIキー必要、会員登録で取得）
- 賛助会員: 個人年3,000円、入会金なし
- メイン4社（琉球バス・那覇バス・沖縄バス・東陽バス）のGTFS-RTは**なし**（OTTOP確認済み2026年4月）
- メイン4社のリアルタイムデータは引き続きバスナビ沖縄API（モバイルクリエイト社）を使用
- 東京バス・やんばる急行・カリー観光・沖縄エアポートシャトルは確実にカバー
- Agency ID: 東京バス=574、カリー観光=372、やんばる急行=1082、沖縄エアポートシャトル=367
- 東京バスGTFS-RT: agencyId `7011501003070` で車両位置取得可能（protobuf→JSONプロキシ実装済み `/api/TokyoBusPositions`）
- 車両名は「Okibus」（沖縄の東京バスブランド）、route_id 795/796（OTTOP内部ID、TK01-TK06へのマッピング未完）
- やんばる急行: 公式バスロケあり（yanbaru-bus-navi.com）、OTTOP GTFS-RT対応は未確認
- カリー観光: リアルタイムなし（時刻表のみ）
- 沖縄エアポートシャトル: Bus-Vision（公開APIなし）

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

## 未解決の課題
- 祝日便（例: 120番）: 平日に祝日便が走っていたケースあり。原因・対策は保留

## 実装済みの仕様・設計判断
- 他社バス（バスナビ沖縄API対象外）: 時刻表ベースで統合
  - 東京バス（TK01〜TK06）— 注記: 「Google Mapsで遅延情報を確認できます」
  - カリー観光（北谷ライナー、パルコシティシャトル）— 注記: 「リアルタイム位置情報なし」
  - やんばる急行バス（YKB888/YKB3T/YKB-HLT）— 注記: yanbaru-bus-navi.comへのリンク
  - 沖縄エアポートシャトル（OAS-APL/OAS-RSL/OAS-RSL-RP）— 注記: Bus-Vision（bus-viewer.jp/okinawa-shuttle/）へのリンク
  - ルート定義はGTFS時刻表のバス停名と完全一致させること（漏れると検索に出ない）
  - バス停検索ではAPIバス停と他社バス停の路線情報をマージ表示
- GTFS時刻表: `src/otherBusTimetable.js`（`scripts/build-timetable.cjs`で生成）
  - 方向別キー: `会社名:路線:方向インデックス`（例: `東京バス:TK02:0`）
  - DIRECTION_META: 各方向の始発・終着バス停名、方向マッチングに使用
  - flags: 1=乗車専用(降車不可)、2=降車専用(乗車不可)
  - 30分以内の便のみ表示、次の便がない路線は非表示
- 始発停の時刻表API補完済み（getTimetableBuses）
- ETA: 出発地到着基準。計算: actualArrival + remainingScheduledMinutes - now
- 遅延表示: 遅れのみ（早発は非表示）、15停留所以内に限定
- 逆方向フィルタ: 行先が出発地と一致→除外。isTimetableバスは行先が目的地にマッチしなければ除外
- Google Mapsリンク: 全社統一で出発バス停→目的バス停の経路案内
- ふりがな検索: READING_ALIASES（55件）+ 他社バス停にyomigana付与
- 那覇空港の乗り場番号: 実装済み（メイン4社+他社バス）
- Service Worker: network-first戦略
- Approach API補完: 出発地＋目的地の両方のキャッシュから路線取得（デュアルキャッシュ）
- matchStation: EXCLUDED_SUFFIXESで部分一致誤爆を防止
- 空港バス停名の内部統一: 那覇空港/国内線旅客ターミナル前/国際線旅客ターミナル前 → 旅客ターミナル前

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
