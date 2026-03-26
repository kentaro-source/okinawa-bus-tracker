# バスどこ沖縄 - プロジェクト方針

## 概要
沖縄のバスリアルタイム位置情報アプリ（PWA）。バスナビ沖縄APIを利用。
県外観光客が主要ターゲット。Googleマップで乗換案内→このアプリで遅延確認→地図でバス停へ、の導線。

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

## コーディング規約
- 日本語コメント推奨（ユーザーが日本語話者）
- console.warnでAPI失敗を記録（catchで握りつぶさない）
- ETAは「定刻＋遅延」で計算。始発停（OrderNo ≤ 2）の遅延データは信頼しない。
- 未出発バスは定刻過ぎでも消さない（遅延表示して残す）

## UI方針
- 誤解を招く表現は避ける（例: 「最速」は到着順を保証できないため使わない）
- Googleマップ連携: バス停名で検索リンク（座標ではなく名前ベース）
- 走行中バスを上、未出発を下にグループ表示

## 既知の課題
- 読谷バスターミナルが検索に出ない（API側の駅名を要確認）
- 上り/下りバス停の区別が未実装
- バス停キャッシュがない初回は全路線スキャンに時間がかかる

## コミュニケーション方針
- やり取りで得た方針・学びはこのCLAUDE.mdに自動追記する（PC間共有のため）
- 応答は簡潔に。長い説明は不要
- 日本語でやり取り

## Git運用
- ブランチ: `claude/intelligent-mirzakhani`
- Cloudflare Pagesで自動デプロイ
- PR: https://github.com/kentaro-source/okinawa-bus-tracker/pull/1
- Git設定: kentaro-source / kentaro@kawagoe-sangyoui.com
