# バスどこ沖縄

## 概要
沖縄のバスリアルタイム位置情報アプリ（PWA + TWA）
- Package ID: `com.busdoko.okinawa`
- デプロイ: Cloudflare Pages (`okinawa-bus.pages.dev`)
- データソース: busnavi-okinawa.com API
- ビルド: `npm run build` → `npx wrangler pages deploy dist --project-name=okinawa-bus --branch=main --commit-dirty=true`

## 技術スタック
- React + Vite
- Cloudflare Pages（ホスティング + CORSプロキシ）
- PWA（Service Worker + manifest.json）
- TWA（Android APK via PWABuilder）

## 主要な設計判断
- 全プロジェクトPWA + TWA統一方針（修正はサイトデプロイのみで反映）
- デフォルト: 出発=那覇空港、目的地=那覇バスターミナル（路線が多く初回表示のインパクト重視）
- バス停選択はクイックアクセス＋お気に入りのみ（一覧表示なし、検索で絞り込み）
- バックエンドにSupabase利用可能

## 主要バス停（クイックアクセス）
那覇バスターミナル / 国際通り入口 / アメリカンビレッジ / 県庁北口 / イオンモール沖縄ライカム / 普天間 / 具志川バスターミナル / おもろまち駅前

## ロードマップ
1. 自分で使い込む（2026年3月末〜）
2. 知り合いに配布テスト（4月上旬・新学期）
3. LINE bot化（バス情報＋要望受付）
4. 多言語対応（日中韓英）
5. 2月: プロ野球キャンプ地バス停を季節追加

## 収益化・公開方針
- 当面は広告なし・無料
- Google Play公開前にモバイルクリエイト社にデータ利用許諾を取る
- 公益性を重視、筋を通してから拡大

## コミュニケーション
- 技術用語（PR、Git等）は使わず日本語で結果だけ伝える
- 簡潔に、余計な説明はしない
