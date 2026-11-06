import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const ts = createRequire(import.meta.url)('typescript');
const source = await readFile(new URL('../../src/workshop/production.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { acceptProductionSnapshot, productionAssetPose } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('delayed HTTP responses cannot override a newer authoritative WebSocket run', () => {
  assert.equal(typeof acceptProductionSnapshot, 'function');
  const a = { run_id: 'A', revision: 90 }, b = { run_id: 'B', revision: 0 }, c = { run_id: 'C', revision: 1 };
  assert.equal(acceptProductionSnapshot(a, c, 'stream'), c);
  assert.equal(acceptProductionSnapshot(c, b, 'command'), c);
  assert.equal(acceptProductionSnapshot(c, { ...c, revision: 0 }, 'command'), c);
  const next = { ...c, revision: 2 };
  assert.equal(acceptProductionSnapshot(c, next, 'command'), next);
});
test('part selection follows its station position independently of an empty carrier', () => {
  const snapshot = { parts: [{ id: 'P001', position: [-12, 1.55, -8] }], amrs: [{ id: 'AMR01', position: [0, .35, 1.2] }], robots: [] };
  assert.deepEqual(productionAssetPose(snapshot, 'P001'), { position: [-12, -8], height: 1.55 });
  assert.deepEqual(productionAssetPose(snapshot, 'AMR01'), { position: [0, 1.2], height: .35 });
});
