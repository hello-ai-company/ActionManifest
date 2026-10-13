#!/usr/bin/env python3
"""Generate policy mirrors only. Never generates permissions or execution adapters."""
import argparse, hashlib, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(); p.add_argument('--matoe-root', type=Path); p.add_argument('--check', action='store_true'); args = p.parse_args()
raw = (ROOT/'contracts/matoe/integration-v1.json').read_bytes(); c = json.loads(raw); digest = hashlib.sha256(raw).hexdigest()
assert c['contract_version'] == '1.0.0' and not c['external_execution'] and not c['real_world_completion']
assert len(c['native_tools']) == 101 and len(c['action_kinds']) == 13
header = f'// Generated from contracts/matoe/integration-v1.json. SHA256 {digest}. Do not edit.\n'
ts = header + 'export const MATOE_INTEGRATION_CONTRACT = ' + json.dumps(c, ensure_ascii=False, indent=2) + ' as const;\n'
ts += '''export function matoeActionMapping(kind: string) {
  return Object.hasOwn(MATOE_INTEGRATION_CONTRACT.action_kinds, kind)
    ? MATOE_INTEGRATION_CONTRACT.action_kinds[kind as keyof typeof MATOE_INTEGRATION_CONTRACT.action_kinds] : undefined;
}
'''
swift = header + 'import Foundation\n\nenum MatoeIntegrationContract {\n'
swift += f'    static let version = "{c["contract_version"]}"\n    static let sourceSHA256 = "{digest}"\n    static let receiptVersion = "{c["receipt_version"]}"\n'
swift += '    struct ActionMapping { let nativeType: String; let preparationAdoption: Bool; let portableOperation: String }\n'
swift += '    static let actionKinds: [String: ActionMapping] = [\n'
for kind, m in c['action_kinds'].items():
    swift += f'        "{kind}": .init(nativeType: "{m["native_type"]}", preparationAdoption: {str(m["preparation_adoption"]).lower()}, portableOperation: "{m["portable_operation"]}"),\n'
swift += '    ]\n    // Advisory inventory only. AgentTool and its existing adapters own all execution.\n'
swift += '    static let nativeTools: Set<String> = [' + ', '.join(json.dumps(k) for k in c['native_tools']) + ']\n'
swift += '    static let localOperations: Set<String> = [' + ', '.join(json.dumps(k) for k in c['local_operations']) + ']\n'
swift += '    static let receiptStatuses: Set<String> = [' + ', '.join(json.dumps(k) for k in c['receipt_statuses']) + ']\n}\n'
outputs = {ROOT/'packages/consumer/src/matoe-contract.generated.ts':ts.encode()}
if args.matoe_root:
    outputs[args.matoe_root/'Contracts/ActionManifest/integration-v1.json'] = raw
    outputs[args.matoe_root/'Otayori/Services/Analysis/MatoeIntegrationContract.generated.swift'] = swift.encode()
for path, data in outputs.items():
    if args.check:
        if not path.is_file() or path.read_bytes() != data: raise SystemExit(f'STALE generated contract: {path}')
    else:
        path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
print(f'PASS: shared contract {c["contract_version"]}; {len(outputs)} identical generated artifacts; {digest}')
