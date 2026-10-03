# Matoe側に必要な受入・表示の契約

ActionManifestの性能改善で、Matoeの安全な受入範囲を広げるために検証を弱めてはいません。
既存74fixtureを実際のdeterministic extractor → verifier → converterへ通した結果は
改善前後とも39件受入／35件拒否です。条件付き提出、保護者の署名、雨天代替日、曖昧日、
warnings、異なる引用が一般的な対応外入力です。

今回広げたのは、**引用だけでなく全locatorも同一のEvidence重複**です。Swiftが最初の要素しか
読む場合でも完全に同じ内容なので失われる情報はありません。入力、wire、auditのコピーは全て残します。
異なるtext/page/bbox/section/source_reference、actor.role、timezone、conditions/notes、
verification issuesの拒否は維持しています。

## 39受入／35拒否が学校通知で意味すること

これは合成74fixtureの文書単位の互換結果で、利用者全体の成功率ではありません。
最初の拒否理由は条件/notes 13、時間表現9、検証issues 6、異なるEvidence 5、actor 2。
複数の非対応情報を含む文書もあるため、各フィールドの出現件数ではありません。
全件の内訳は[計測JSON](../evidence/PERF-20261002/compatibility-after.json)に残しています。

| 通知の用途と実fixture | 汎用0.2で保持できる情報 | 現Matoeで止まる理由／必要な対応 |
| --- | --- | --- |
| 希望者のみ返信・持参、提出済みなら再提出不要 (`school-applicants-only`, `school-bring-own`, `school-already-submitted`) | conditions、対象者、原文、必須/推奨の区別 | 条件が表示・確認判定に反映されない。対象/免除条件を保持・表示し、無条件の必須扱いを避ける |
| 保護者の署名、和暦による提出期日 (`school-guardian-signature`, `school-reiwa-date`) | guardian role、根拠と照合できる日付 | 主にroleの情報損失で拒否。日付解析失敗と混同しない。誰が行うかをdomainに保持・表示する |
| 「10月ごろ」「10月上旬」の予定 (`school-around-october`, `school-early-october`) | approximate/month/decade、raw_text、未知の日 | exact/day限定に収まらない。曖昧さを表示し、特定の1日や通知時刻を勝手に生成しない |
| 遠足の雨天順延・複数条件付き予定 (`school-rain-postponement`, `school-golden-excursion`, `adv-jp-conditional-date-rain`) | 条件/代替日、複数引用とlocator | 複数の根拠や豊富なtemporalが対象外。全根拠と代替条件を表示し、主日付への丸めを避ける |
| 中止・免除・複数文の否定 (`adv-jp-cancellation`, `adv-jp-cross-sentence-negation`, `adv-jp-exemption-health`) | warning/error、否定・免除の根拠、アクション別の検証結果 | issuesが見えない場合は拒否。UI対応後も検証失敗はblocked、不足はreviewとし、成功へ書き換えない |
| 必着/消印有効などの申請期限 (`gov-tax-postmark-en`, `university-application-en`) | deadline_qualifierと根拠 | 一般的な「締切日」だけでは意味が不足。到着/発送条件を保持・表示する |

学校通知以外の例も含むコーパスなので、Matoeの実利用頻度の推定には使えません。
timezoneとnotesは今回の74件の代表理由には現れませんが、契約fixtureで独立に検証します。

現在のSwiftで意味を保持できるのは、条件/注意なしで根拠・対象者が表示されるAction、
日付なし又は整合したexact/day、完全に同じ根拠の重複、proposed/verifiedの制限内です。
wireで表せない0.2の検証詳細と本来の抽出来歴は、bundleのaudit原本で保持します。
audit保存は表示の代わりにはならないため、上表の情報をauditへ移すだけでは受入を広げません。
OSS側はこれらの情報を原manifestに保持できています。今回、汎用モジュールへMatoeの
拒否条件を追加せず、公開APIでの保持とMatoe拒否を同時に確認する回帰テストを追加しました。

## Design担当へのfixtures

`packages/consumer/fixtures/matoe/design-handoff/source.txt`をそのままcanonicalSourceTextとして、
同じディレクトリのJSONを実際のSwift bridgeに入力できます。全てnative 0.1.0のschemaに適合し、
SHA-256は対応する本文のUTF-8 bytesと一致します。下表の雨天/曖昧日2件だけは
`temporal-source.txt`をcanonicalSourceTextに使い、他6件は`source.txt`を使います。
未知version拒否の問題と、domainへの情報保持・表示の
問題を分けて調べるため、0.2のversion gateで止まるfixtureにはしていません。

これらは手書きの**proposed・未承認**契約fixturesで、provider/modelもfixtureと明記しています。
warningケースは検証が不完全な保守的なフラグを持ちます。実サービスの検証成功・ユーザー承認・支払い・送信の証拠ではありません。
現ActionManifest converterが全件を拒否する回帰テストを置いています。

| Fixture | 現在のSwiftの情報損失 | 必要な受入・表示・確認条件 |
| --- | --- | --- |
| guardian.json | actor.roleはdecodeされるがAnalysisItemに残らない | actor.text/roleを保持して対象者を表示。不明・対象者違いは確認を要求。guardianを削除して通さない |
| timezone.json | temporal.timezoneは無視され、端末の現在のtimezoneでDateを作る | day/dateのcivil dateを保持し、指定timezoneを保持・表示。時刻のある入力は精度・offsetとの整合も検証。端末zoneへの無言変換をしない |
| conditions.json | conditionsを表示・確認判定に使わない | 条件をdomainとUIに保持し、対象者条件がある場合の確認理由を表示。無条件の必須に丸めない |
| notes.json | notesを表示・確認判定に使わない | notesの内容を保持・表示。要確認の注意事項をユーザーが確認できること |
| warning.json | 詳細issueのcode/messageをAnalysisItemに渡さない | action_idで結び付け、code/message/severityを表示。warningにも確認理由を保持し、未知codeは成功の根拠にしない |
| multiple-evidence.json | 最初の引用のみ保持 | 全てのtext/locatorを保持・参照可能にする。引用ごとのsource_id/page/bboxの検証を維持 |
| rain-alternative.json | exact主日付以外の代替日/条件をdomainへ保持しない | 主日付とconditional代替日を別々に保持・表示。雨天条件を落とさず、両方を同時必須にしない |
| approximate-date.json | 日付を持たないapproximate/monthを予定表示に十分反映できない | raw_text/month/precision/certaintyを保持・表示。存在しない日をDateへ生成しない |

正の対照は同階層の`../expected-wire-v01.json`＋`../source.txt`です。
元0.2の`../verified-v02.json`から現converterで得られるwireと完全一致するゴールデンで、
同fixtureでは期日・根拠・状態の保持、audit原本の保持をassertします。
上表8件は「現在のMatoe projectionは拒否する／対応後のSwiftは情報を失わず表示する」
負の対照です。Swift bridge自体が現在これら全てをdecode拒否する、という意味ではありません。
未知version/hash不一致/承認済み状態などの安全性違反は、対応後も拒否する既存負テストを維持します。

proposedなので現SwiftのneedsUserConfirmationはtrueになるはずですが、それだけで情報保持を確認したことには
なりません。テストでは表示・保存される各値も比較してください。手元のSwiftコードでのsource比較に基づく期待であり、
この環境でSwift/iOSを実行した結果ではありません。

## Version / 検証境界

現Swift契約の参照点はOtayori `696b2ebb21e28dbf6ba56cfce68c29f6df1480b9`の
[ActionManifestContract.swift](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift)。
今回の作業では新しい外部接続やOtayori repoの変更はしていません。従来のread-only調査と
[セルフレビュー記録](../evidence/MATOE-20261002/SELF-REVIEW.md)に基づく引き継ぎです。

上記の0.1受入・表示を整えた後も、0.2のアクション別検証や混在結果の受入は別の契約変更です。
単にsupportedSchemaVersionへ0.2を追加せず、凍結0.2 schemaによるshape検証、receipt version整合、
一意で完全なper-action結果、集計値との整合、hash/証拠/negation/page検証と承認状態制限が必要です。
失敗・不足・未知をverifiedへ丸めないでください。

最小の次段階は、Matoe担当がnative 0.1 fixturesを実Swiftで読み、表示・保持・確認理由のassertionを追加することです。
バックエンド、Release URL、HTTP、監査保存、実機のtimezone/DSTは引き続き未検証です。
