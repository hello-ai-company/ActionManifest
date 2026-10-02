# Matoeとの明示的な接続

既定のextractor、schema、JSON exporterは引き続き0.2.0です。Matoe（Otayori）の
Swift bridgeは0.1.0だけを受け入れ、未知フィールドも拒否します。
`prepareMatoeManifest` / `actionman prepare-matoe`は、この境界専用の**明示変換**です。
支払い・返信を実行するものではありません。

## 確認した契約

ActionManifestの比較基点は`18c159c0bbb238b410c003cc8e60e7a8e013309f`。
0.1と0.2でsource/actionsのschemaは同じです。差分はrootのversionと、
verificationの`passed`、4つの集計値、`actions`（アクション別検証結果）です。
凍結schemaは変更していません。
schema選択については、登録済みのversionだけを参照するようCoreを修正しました。
変更前は`constructor`や`toString`が継承プロパティとして参照され、未知versionでも
schema検証を迂回して受理されることをローカルで再現しました。回帰テストで拒否を固定しています。

接続済みGitHubから、Otayoriの`696b2ebb21e28dbf6ba56cfce68c29f6df1480b9`を読み取りました。

- [ActionManifestContract.swift](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift)：0.1のみ許可、未知キー/null拒否、OCR本文hash照合、proposed/verifiedのみ受け入れ。取得時mainの同ファイルも同じblobでした。
- [AnalysisService.swift](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/AnalysisService.swift#L268)：HTTP応答をbridgeへ渡し、request.ocrTextで照合。
- [ServiceTests.swift](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/OtayoriTests/ServiceTests.swift#L3450)：0.2拒否と未知プロパティ拒否のテスト。
- [analysis_server.py](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Server/analysis_server.py)：旧documentTitle/items形式のPythonサーバー。
- [project.pbxproj](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori.xcodeproj/project.pbxproj#L448)：ReleaseのANALYSIS_BASE_URLは空欄。実ビルドでの設定上書き・別の稼働バックエンドは未確認。

独立したActionManifestBridge.swiftは存在せず（404）、bridge実装はContract.swift内です。

## 安全な変換範囲

profileは`matoe-v0.1-clean/1`。JSON schema検証を先に行い、次に追加ポリシーを適用します。

- source.hashが必須。Matoeから受け取った**そのままのOCR文字列**のUTF-8 SHA-256と一致すること。trim・改行変換・Unicode正規化はしない。
- extraction receiptが必須。receiptのschema_versionは入力versionと一致し、provider/model/extractor_versionが空白や`unknown`でないこと。これらの識別子は自己申告の来歴であり、暗号学的な発行者証明にはならない。
- アクションIDは一意。Evidenceは同一source IDに属し、実本文に引用があること（Coreの引用照合を使用）。
- 状態はproposed/verifiedのみ。accepted/exported/rejectedをproposedへ戻さない。
- 未検証なら全アクションがproposedであること。検証を捏造せず、audit.warningsに要確認を明記。Matoe既存bridgeも検証欠落を警告し確認を要求する。
- 検証済みなら全体・個別の全チェックが成功し、errorまたはseverity未指定のissueがないこと。0.2には全アクションの一意な結果と整合する集計値が必要。混在・失敗・不足・矛盾は拒否し、全体成功に丸めない。
- 個別warningは全体issuesにも同じ内容があること。全体issuesはwireに保持し、個別結果はauditに全保存する。
- 時間情報はなし、またはexact/day/dateのみ。整合するyear/month/day、同日のend、until/on_day、certainty/timezoneもそのまま保持可能。datetime、範囲、条件、代替日、曖昧日、必着/消印等は初期profileでは拒否。対応拡張には別途Swiftでの表示・確認動作テストが必要。

出力は`{ manifest, audit }`のbundleです。auditには入力の完全なコピーと変更箇所があります。
wireから外した0.2の検証詳細を捨てません。rootとextractionのschema_versionはwire用に0.1へ変更し、
本来の抽出来歴（0.2）をaudit.originalManifestに保持します。
source/actions、provider/model、抽出日時、検証日時、全体issues、承認状態は変更しません。
変換は再抽出・再検証・再承認ではありません。

## ローカル利用

Node 24.19.0、pnpm 11.23.0で確認します。リポジトリrootから：

```sh
pnpm build
pnpm actionman prepare-matoe packages/consumer/fixtures/matoe/verified-v02.json \
  --doc packages/consumer/fixtures/matoe/source.txt --out /tmp/matoe-bundle.json
```

`--out`省略時はbundle全体をstdoutに出します。出力先が既存なら拒否し上書きしません。
失敗は非ゼロ終了、schema違反は`SCHEMA_VALIDATION`、互換ポリシー違反は
`MATOE_COMPATIBILITY_BLOCKED`と理由をstderrに返します。部分出力やlegacyへのfallbackはしません。

実際のdeterministic抽出からも試せます（外部LLM呼び出しなし）。既定exportは検証済みのみを
フィルタするため、変換の入力には`--include-unverified`で完全なmanifestを使います。

```sh
pnpm actionman extract packages/consumer/fixtures/matoe/source.txt \
  --provider deterministic --include-unverified --out /tmp/matoe-original.json
pnpm actionman prepare-matoe /tmp/matoe-original.json \
  --doc packages/consumer/fixtures/matoe/source.txt --out /tmp/matoe-extracted-bundle.json
```

サーバー側の組み込み箇所は次のようになります（HTTP実装・監査保存はこの変更に含みません）。

```ts
import { prepareMatoeManifest } from "@actionmanifest/consumer";

const bundle = prepareMatoeManifest(fullManifest, request.ocrText);
// 運用側でbundle全体を監査記録として保持できた後に、
// HTTP応答bodyへJSON.stringify(bundle.manifest)を返す。
// bundle全体をSwift bridgeへ送ると未知rootキーとして拒否される。
```

fullManifestは元の全アクションを含むものを使用します。export後にアクションを削除したmanifestは
個別検証結果と件数が一致しない限り拒否します。auditを保持できない経路は使用しません。
wireを一般の0.1抽出原本として配布せず、この変換bundleと組にして扱います。

## 接続の到達点と次の確認

このrepo内で、ビルド済みパッケージ経由のadapter → deterministic extractor → verifier →
互換変換 → 0.1 schema検証と、CLIの入出力/拒否をテストします。ゴールデンwireは
`packages/consumer/fixtures/matoe/expected-wire-v01.json`です。
Swift bridge・iOS画面・HTTP通信・監査保存・実稼働バックエンドのend-to-end成功を意味しません。

Swift側のversion許可や安全検証の変更はこのprofileには不要です。実接続には、確認できたPythonサーバーの
旧形式応答を変更するか、別のActionManifestバックエンドを用意し、監査保持とprofile選択を組み込む必要があります。
現在のPythonサーバーはTypeScriptパッケージを呼んでいないため、本変更だけで接続は完成しません。
別repoは編集していません。

次の最小ステップは、Matoe側の作業として、まずゴールデンwireと同じsource.txtを
既存ActionManifestBridge.decodeで読むSwiftテストを追加し、submissionの期日・要確認状態と
0.2/未知キー/hash不一致/承認済み状態の拒否を確認することです。
その後、ローカル・無課金のHTTPスタブで0.1 wireのみを返し、AnalysisServiceの応答境界を確認します。
実サービスへの設定・デプロイは別の承認された作業です。
