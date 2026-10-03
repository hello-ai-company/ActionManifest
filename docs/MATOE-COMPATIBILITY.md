# Matoeとの明示的な接続

既定のextractor、schema、JSON exporterは引き続き0.2.0です。Matoe（Otayori）の
Swift bridgeは0.1.0だけを受け入れ、未知フィールドも拒否します。
`prepareMatoeManifest` / `actionman prepare-matoe`は、この境界専用の**明示変換**です。
支払い・返信を実行するものではありません。

新しい明示経路では、縮小せず0.2全文を保持する
[サーバー接続契約](MATOE-SERVER-V02.md)を使います。既存0.1 bridgeへは渡せません。
既存bridgeには`schema_version`がない旧documentTitle/items応答を読むlegacy分岐もあります。
その分岐とActionManifestの検証・承認は別の経路です。

Matoeは主要な接続先ですが、その表示制約は汎用schema/extractor/verifierや
`classifyManifest`には適用しません。他consumerは0.2の完全なmanifestを使えます。
[OSS共通部分と製品の境界](OTAYORI-BOUNDARY.md#matoe-first-integration-reusable-oss-contract)、
[学校通知で止まる具体例と表示契約](MATOE-DESIGN-HANDOFF.md)を参照してください。

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
- アクションIDは一意。Evidenceは同一source IDに属し、実本文に引用があること（Coreの引用照合を使用）。Swiftは最初の引用しか表示しないため、異なる引用・ページ・bbox・section・source_referenceを持つ複数Evidenceは拒否する。全フィールドが完全に等しい重複だけは情報損失がないため受け入れ、wire/audit双方に全コピーを保持する。actor.textがある場合、その文言が表示される引用にも含まれること。表示されないactor.roleは拒否する。
- 状態はproposed/verifiedのみ。accepted/exported/rejectedをproposedへ戻さない。
- 未検証なら全アクションがproposedであること。検証を捏造せず、audit.warningsに要確認を明記。Matoe既存bridgeも検証欠落を警告し確認を要求する。
- 検証済みなら全体・個別の全チェックが成功し、errorまたはseverity未指定のissueがないこと。0.2には全アクションの一意な結果と整合する集計値が必要。混在・失敗・不足・矛盾は拒否し、全体成功に丸めない。
- warningも初期profileでは拒否する。Swiftはそのメッセージを表示せず、warning単独では要確認にもならないため。検証詳細の保管だけでは表示時の安全性を保証できない。
- conditions（空配列以外）とnotesは拒否する。Swiftはこれらを表示・要確認判定に使わない。
- 時間情報はなし、またはexact/day/dateのみ。整合するyear/month/day、同日のend、until/on_day、certaintyはそのまま保持可能。timezoneは明示されていれば拒否する。Swiftは端末の現在のタイムゾーンで日付を変換し、wireのtimezoneを使わないため。datetime、範囲、条件、代替日、曖昧日、必着/消印等も初期profileでは拒否。対応拡張には別途Swiftでの表示・確認動作テストが必要。
- receipt日時はSwiftの実際の厳密パーサーに合わせ、uppercase T/Zと秒00..59を要求する。JSON schemaだけが許容するlowercaseや空白区切り、うるう秒等は拒否する。
- CLI入力はmanifest 1 MiB、OCR 240,000 UTF-8 bytes / 60,000 Unicode scalarsまで。APIにも入力予算とネスト深さ24の制限がある。未知フィールドをサイズ制限の対象外にしない。CLIはサイズ制限内の通常ファイルと有効なUTF-8のみ読み込む。

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

`--out`または`--json`をちょうど1つ指定します。`--json`はbundle全体をstdoutへ出す明示指定です。
指定なしでは原データを出力しません。bundleには原manifestとEvidence引用が含まれ、入力自身に秘密が
あればそれも保持されます。自動的な秘密の検出・削除はしません。本文を別途追加したり環境変数の認証情報を読み込むことはありません。
`--out`はmode 0600で新規作成し、既存の出力先は拒否します。
失敗は非ゼロ終了、schema違反は`SCHEMA_VALIDATION`、互換ポリシー違反は
`MATOE_COMPATIBILITY_BLOCKED`と理由をstderrに返します。入力を含むschema/JSON/ファイルエラーの詳細は省略し、
原文・未知version文字列・アクションID・パスを変換診断のstderrに転載しません。
変換失敗時にはbundleを返さず、legacyへのfallbackもしません。

実際のdeterministic抽出からも試せます（外部LLM呼び出しなし）。既定exportは検証済みのみを
フィルタするため、変換の入力には`--include-unverified`で完全なmanifestを使います。

```sh
pnpm actionman extract packages/consumer/fixtures/matoe/plain-source.txt \
  --provider deterministic --include-unverified --out /tmp/matoe-original.json
pnpm actionman prepare-matoe /tmp/matoe-original.json \
  --doc packages/consumer/fixtures/matoe/plain-source.txt --out /tmp/matoe-extracted-bundle.json
```

この例はactorがunknownの入力で、Matoeは確認を要求します。保護者を明記した元のsource.txtからは
deterministic extractorが`actor.role=guardian`を出すため、初期profileでは理由付きで拒否されます。
そのroleを後から削除して回避するのではなく、対応profileまたはSwiftの表示・確認動作を別途整える必要があります。

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
