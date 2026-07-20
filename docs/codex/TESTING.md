# TESTING

## 前提条件
- Node.js が利用できること
- リポジトリのルートディレクトリで実行すること

## 実行コマンド
```bash
node tests/run-all.js
```

## 成功・失敗の見方
- すべて成功: 各テスト実行結果の最後に `All tests passed (...)` が表示され、終了コードは `0`
- 失敗あり: `Test run failed (...)` が表示され、終了コードは `0` 以外
