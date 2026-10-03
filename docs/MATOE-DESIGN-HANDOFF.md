# Matoe側に必要な受入・表示の契約

ActionManifestの性能改善で、Matoeの安全な受入範囲を広げるために検証を弱めてはいません。
既存74fixtureを実際のdeterministic extractor → verifier → converterへ通した結果は
改善前後とも39件受入／35件拒否です。条件付き提出、保護者の署名、雨天代替日、曖昧日、
warnings、異なる引用が一般的な対応外入力です。

今回広げたのは、**引用だけでなく全locatorも同一のEvidence重複**です。Swiftが最初の要素しか
読む場合でも完全に同じ内容なので失われる情報はありません。入力、wire、auditのコピーは全て残します。
異なるtext/page/bbox/section/source_reference、actor.role、timezone、conditions/notes、
verification issuesの拒否は維持しています。

## Design担当へのfixtures

`packages/consumer/fixtures/matoe/design-handoff/source.txt`をそのままcanonicalSourceTextとして、
同じディレクトリのJSONを実際のSwift bridgeに入力できます。全てnative 0.1.0のschemaに適合し、
SHA-256は同じsource.txtのUTF-8 bytesと一致します。未知version拒否の問題と、domainへの情報保持・表示の
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
