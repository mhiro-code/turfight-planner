# TP-2026-0811-MRR-ISSUE-B Execution Brief

## 承認と担当

- 案件ID: `DEV-2026-0811-TURFIGHT-ROUND`
- オーナー承認: 2026-08-11、実装再開とIssue B着手を明示承認
- 指揮: 黒田官兵衛（案件限定）
- プロダクト／受入条件: 武田信玄
- 実装: 豊田佐吉（案件限定、下記の所有ファイルのみ）
- 独立検証: ナイチンゲール
- リリース: 伊能忠敬（本 brief の範囲外）

## 基準と作業場所

- Repository: `projects/turfight-planner`
- GitHub `main`: `225e3c0d1f4d33d7794e116992ade63d9537011c`
- ローカル基準ツリー: `23c658a50865d659e84a8af50c8a047deed2346a`
- GitHub比較: 上記2コミット間はマージコミット1件、ファイル差分なし
- 作業ブランチ: `codex/turfight-issue-b-round-catalog`
- 作業場所: `projects/turfight-planner-issue-b`
- 保全対象: 元 checkout の `issue-87-run-all-tests` と未追跡 `docs/codex/TESTING.md`、`tests/run-all.js`

## 今回の範囲（Issue Bのみ）

承認済みArchitecture v1.1.1の `A -> D -> B -> C -> E` に従い、schema v4 とIssue Dの非破壊保存基盤の上に、募集回カタログと選択UIを追加する。

- DOM上の安定した `data-recruitment-round-id`／名称をカタログとして列挙する
- Rootの `activeRecruitmentRoundId` と募集回セレクターを同期する
- 募集回切替時に、旧募集回を保存してから新募集回の設定、Plan集合、馬カードを適用する
- 現在募集回だけを表示・集計・フィルター対象にする
- 既存のschema-v4、localStorageキー、Issue Dのcapture/apply・upsert契約を維持する
- カタログが1件でも壊れず、複数のDOMカタログを注入したテストでは切替を確認できるようにする

## 非対象と停止条件

- Issue C（Plan CRUD）、Issue E（統合・移行テスト）の同時実装
- 募集馬データの自動取得、外部通信、認証、依存関係追加、schema変更
- 募集回の追加・編集・削除画面、メインページの新設、CSS全面再設計
- 元 checkout の変更、未追跡ファイルの移動・破棄
- commit、push、PR、Ready化、merge、Pages公開、Issue操作
- 実際の募集回名・馬データを根拠なく追加すること

次のいずれかが必要になったら実装を止め、指揮へ戻す。

- schema v4の契約変更または新しい移行が必要
- 現在回以外のデータを上書き・削除する経路が残る
- 実データの出所が確認できない
- UI変更が既存のPC／iPad操作領域を壊す
- 所有ファイルの重複、外部送信、別ゲートの操作が必要

## 所有ファイルと検証

- 豊田佐吉の所有: `index.html`、`tests/issue-b-recruitment-round-selector.test.js`
- 指揮の所有: 本 brief と証跡の統合
- ナイチンゲール: 実装完了後に読み取り専用で正例・負例・境界・回帰・承認範囲を検証

受入条件:

1. カタログに複数の募集回があるとき、セレクターで安定IDを選択できる。
2. 選択回の設定とPlan集合が表示され、別回の設定・Plan・馬選択は保持される。
3. 切替後の保存・再読込で `activeRecruitmentRoundId` と各回の `activePlanId` が整合する。
4. カタログ1件、対象ID不在、読込／検証失敗、未知フィールド、DOMにない保存値で既存の安全策を壊さない。
5. schema-v4既存テスト、Issue Dテスト、Issue Bテスト、`git diff --check` が通る。
6. PC相当とiPad相当の表示で、募集回選択・Plan選択・入力保存に関連するコンソールエラーと横溢れがない。

## Gate状況

- Gate 0: 完了（案件振り分け・担当軍師・範囲承認）
- Gate 1: 完了（GitHub基準確認・隔離作業場所）
- Gate 2: 完了（OSS調査・設計承認）
- ローカル実装／独立検証: 完了（ナイチンゲール `PASS`、自動テスト・PC/iPad相当UI確認済み）
- Gate 3承認: 2026-08-11、オーナーが `承認`。本ブランチのcommit・push・Draft PR作成を承認済み。
- Gate 3実行: 完了。commit `af387ba`、originへのpush、Draft PR #97作成済み。
- Draft PR: https://github.com/mhiro-code/turfight-planner/pull/97
- Ready化、merge、release: 未承認・未実施（別ゲート）。
