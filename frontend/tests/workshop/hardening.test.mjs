import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const productionSource = await readFile(new URL('../../src/workshop/production.ts', import.meta.url), 'utf8');
const modelCode = ts.transpileModule(productionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(modelCode).toString('base64')}`);
const objectSource = await readFile(new URL('../../src/workshop/Objects.tsx', import.meta.url), 'utf8');
const objectCode = ts.transpileModule(objectSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(objectCode, { exports, require: name => name === 'react' ? { useMemo: fn => fn(), useRef: () => ({ current: null }), useEffect: () => {} } : name === '@react-three/fiber' ? { useFrame: () => {} } : require(name) });
function geometries(element, kind, matches) {
  if (!element || typeof element !== 'object') return 0;
  if (Array.isArray(element)) return element.reduce((sum, node) => sum + geometries(node, kind, matches), 0);
  if (typeof element.type === 'function') return geometries(element.type(element.props), kind, matches);
  return (element.type === kind && matches(element.props.args) ? 1 : 0) + geometries(element.props?.children, kind, matches);
}
const asset = kind => ({ id: kind === 'amr' ? 'AMR02' : 'STOCK', kind, footprint: [4, 3], position: [0, 0], name: { zh: 'test', en: 'test' } });
const props = { selected: false, onSelect() {}, showLabels: false };
const countBox = (element, w, h) => geometries(element, 'boxGeometry', args => args[0] === w && args[1] === h);

test('production disables every decorative cargo mesh while demo retains its stock', () => {
  const amr = showStock => exports.AMR({ ...props, asset: asset('amr'), position: [0, 0], heading: 0, showStock });
  assert.equal(countBox(amr(false), .7, .3), 0, 'empty production AMR02 must not have a decorative box');
  assert.equal(countBox(amr(true), .7, .3), 1, 'demo box stays available');
  for (const [kind, w, h] of [['raw', .74, .27], ['finished', .74, .27], ['buffer', .7, .58], ['tooling', .58, .56]]) {
    const render = showStock => exports.StaticAsset({ ...props, asset: asset(kind), showStock });
    assert.equal(countBox(render(false), w, h), 0, `${kind} production stock must come from backend parts`);
    assert.ok(countBox(render(true), w, h) > 0, `${kind} demo stock is preserved`);
  }
  for (const [name, radius, height] of [['Lathe', .16, .88], ['Mill', .22, .42]]) {
    const samples = showStock => geometries(exports[name]({ ...props, showStock }), 'cylinderGeometry', args => args[0] === radius && args[2] === height);
    assert.equal(samples(false), 0, `${name} must not add a duplicate workpiece`);
    assert.equal(samples(true), 1);
  }
});

test('order fault labels distinguish active impact, history and finished work', () => {
  assert.equal(typeof model.orderImpactLabels, 'function');
  const order = { affected: true, historically_affected: true, completed: 0, quantity: 2, status: 'in_progress' };
  assert.deepEqual(model.orderImpactLabels(order, false), ['当前受故障影响', '曾受故障影响']);
  assert.deepEqual(model.orderImpactLabels({ ...order, affected: false }, false), ['曾受故障影响']);
  assert.deepEqual(model.orderImpactLabels({ ...order, completed: 2, status: 'completed' }, false), ['已完成', '曾受故障影响']);
  assert.deepEqual(model.orderImpactLabels({ ...order, affected: false, historically_affected: false }, true), []);
});

test('resource counts keep physical queue, incoming reservations and output stock distinct', () => {
  assert.equal(typeof model.machineWaitingCounts, 'function');
  assert.deepEqual(model.machineWaitingCounts({ queue: ['P01', 'P02'], incoming: ['P03'], output: ['P04'] }), { queued: 2, incoming: 1, output: 1 });
});

test('production scene labels preserve authoritative waiting and blocked states in both languages', async () => {
  const compile = (source, dependencies = {}) => {
    const result = {};
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports: result, require: name => dependencies[name] ?? require(name) });
    return result;
  };
  const sceneModel = compile(await readFile(new URL('../../src/workshop/model.ts', import.meta.url), 'utf8'));
  const { WorkshopScene } = compile(await readFile(new URL('../../src/workshop/Scene.tsx', import.meta.url), 'utf8'), {
    react: { useMemo: fn => fn(), useRef: () => ({ current: null }), Suspense: 'suspense' },
    '@react-three/drei': { Line: 'line', OrbitControls: 'controls' },
    '@react-three/fiber': { Canvas: 'canvas' }, './model': sceneModel, './production': model, './Objects': exports,
  });
  const findTag = element => {
    if (!element || typeof element !== 'object') return null;
    if (Array.isArray(element)) return element.map(findTag).find(Boolean);
    if (element.type?.name === 'TagFromParent' && element.props.asset.id === 'L01') return element;
    return findTag(element.props?.children);
  };
  for (const [status, zh, en] of [['waiting', '等待资源', 'Waiting'], ['blocked', '下游阻塞', 'Blocked']]) {
    for (const lang of ['zh', 'en']) {
      const state = sceneModel.createSimulation(); state.machines.L01.status = 'idle';
      const scene = WorkshopScene({ lang, state, selectedId: 'L01', onSelect() {}, showLabels: true, showRoutes: false, view: 'orbit', copy: { idle: lang === 'zh' ? '待机' : 'Idle' }, onReady() {}, production: { parts: [], orders: [], robots: [], amrs: [], bottlenecks: [], machines: [{ id: 'L01', status }] } });
      const tag = findTag(scene);
      assert.ok(tag, 'machine floor tag exists');
      const plate = tag.type(tag.props);
      assert.equal(plate.props.title, `L01 · ${lang === 'zh' ? zh : en}`);
    }
  }
});
