import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Copy } from "./copy";
import { AMR, Lathe, Mill, Robot, RobotRail, StaticAsset, WorldPlate, ZoneSign } from "./Objects";
import { amrPose, assetPose, ASSETS, PROCESS_PATH, PROCESS_STAGES, ROBOT_CELLS, processPose, robotPose, WORKPIECE_ASSET } from "./model";
import type { SimulationState, WorkshopAsset } from "./model";
import { productionAssetPose } from './production';
import type { ProductionSnapshot } from './production';

type ViewMode = "orbit" | "top" | "focus";

const zoneLabels = {
  raw: { zh: "01 原料收货", en: "01 RECEIVING & STOCK", color: "#d2a75a" },
  turning: { zh: "02 数控车削", en: "02 CNC TURNING", color: "#5bcfbc" },
  milling: { zh: "03 加工中心", en: "03 MACHINING CENTERS", color: "#5bcfbc" },
  post: { zh: "04 去毛刺 · 清洗", en: "04 FINISHING", color: "#73b8d1" },
  quality: { zh: "05 尺寸检验", en: "05 QUALITY CONTROL", color: "#8bc9b0" },
  finished: { zh: "06 包装发运", en: "06 PACKING & SHIP", color: "#d2a75a" },
  support: { zh: "工装 · 维修支持", en: "TOOLING · MAINTENANCE", color: "#9aabb2" },
} as const;

function WorkshopFloor({ lang, labels, routes, activeStage, production = false }: {
  lang: "zh" | "en"; labels: boolean; routes: boolean; activeStage: number; production?: boolean;
}) {
  const processLine = useMemo(() => PROCESS_PATH.map(([x, z]) => [x, 0.14, z] as [number, number, number]), []);
  return <group>
    <mesh receiveShadow rotation-x={-Math.PI / 2} position={[0, -0.14, 0]}>
      <planeGeometry args={[48, 30]} />
      <meshStandardMaterial color="#293439" roughness={0.84} metalness={0.12} />
    </mesh>
    <gridHelper args={[48, 48, "#718086", "#424d51"]} position={[0, -0.105, 0]} />
    <mesh position={[0, 0.045, 0]}>
      <boxGeometry args={[43.5, 0.055, 4.9]} />
      <meshStandardMaterial color="#19323a" emissive="#122d34" emissiveIntensity={0.32} roughness={0.75} />
    </mesh>
    {[-2.25, 2.25].map((z) => <mesh key={z} position={[0, 0.085, z]}>
      <boxGeometry args={[43.5, 0.035, 0.075]} />
      <meshStandardMaterial color="#e5b85c" emissive="#a77128" emissiveIntensity={0.25} roughness={0.55} />
    </mesh>)}
    {[-21, 21].map((x) => <mesh key={x} position={[x, 0.1, 0]}>
      <boxGeometry args={[0.11, 0.04, 4.35]} /><meshBasicMaterial color="#e6bd70" /></mesh>)}
    <mesh position={[0, 0.055, -14.7]}><boxGeometry args={[47.6, 0.08, 0.16]} />
      <meshStandardMaterial color="#485458" metalness={0.34} /></mesh>
    <mesh position={[0, 0.055, 14.7]}><boxGeometry args={[47.6, 0.08, 0.16]} />
      <meshStandardMaterial color="#485458" metalness={0.34} /></mesh>
    <mesh position={[-23.72, 0.055, 0]}><boxGeometry args={[0.16, 0.08, 29.5]} />
      <meshStandardMaterial color="#485458" metalness={0.34} /></mesh>
    <mesh position={[23.72, 0.055, 0]}><boxGeometry args={[0.16, 0.08, 29.5]} />
      <meshStandardMaterial color="#485458" metalness={0.34} /></mesh>
    <FloorBay position={[-3, -8]} size={[24, 7.2]} color="#54cdb7" />
    <FloorBay position={[-3, 8]} size={[24, 7.2]} color="#61aed0" />
    <FloorBay position={[17.5, 8]} size={[11.8, 7.2]} color="#82c8b0" />
    <FloorBay position={[-20, -8]} size={[5.4, 8]} color="#d4ad69" />
    <FloorBay position={[20, -8]} size={[5.4, 7]} color="#d4ad69" />
    <FloorBay position={[-20, 9.8]} size={[5.4, 9]} color="#9aadb2" />
    {routes && <>
      {!production && <Line points={processLine} color="#72dfb9" lineWidth={2.4} dashed dashSize={0.62} gapSize={0.3} />}
      {PROCESS_STAGES.map(({ id, position }, index) => <ProcessStation key={id} id={id} position={position}
        active={activeStage === index} />)}
      <RouteArrow from={[-16, 0.19, -6]} to={[-16, 0.19, -4]} color="#72dfb9" />
      <RouteArrow from={[-1, 0.19, 1.2]} to={[1, 0.19, 1.2]} color="#72dfb9" />
      <RouteArrow from={[20, 0.19, 2]} to={[20, 0.19, 4]} color="#72dfb9" />
      <RouteArrow from={[21, 0.19, -2]} to={[21, 0.19, -4]} color="#72dfb9" />
    </>}
    <AisleMarks />
    {labels && Object.entries(zoneLabels).map(([zone, entry]) => {
      const places: Record<string, [number, number]> = {
        raw: [-20, -13.45], turning: [-3, -12.6], milling: [-2, 12.65], post: [17, 12.4],
        quality: [13, -11.2], finished: [20, -12.45], support: [-20, 14],
      };
      return <ZoneSign key={zone} position={places[zone]} rotationY={places[zone][1] > 0 ? Math.PI : 0}
        label={lang === "zh" ? entry.zh : entry.en} color={entry.color} />;
    })}
    {labels && <WorldPlate name="aisle-label" position={[0, 0.16, -1.48]} rotation={[-Math.PI / 2, 0, 0]}
      size={[6.2, 0.58]} title={lang === "zh" ? "AGV · AMR 共用物流通道" : "AGV · AMR LOGISTICS AISLE"} accent="#74c9b1" />}
  </group>;
}

function FloorBay({ position, size, color }: {
  position: [number, number]; size: [number, number]; color: string;
}) {
  return <group position={[position[0], 0, position[1]]}>
    <mesh position={[0, 0.04, 0]}>
      <boxGeometry args={[size[0], 0.04, size[1]]} />
      <meshStandardMaterial color="#303e42" roughness={0.77} metalness={0.12} />
    </mesh>
    <mesh position={[0, 0.068, -size[1] / 2]}>
      <boxGeometry args={[size[0] - 0.16, 0.025, 0.07]} />
      <meshBasicMaterial color={color} transparent opacity={0.82} />
    </mesh>
    <mesh position={[0, 0.068, size[1] / 2]}>
      <boxGeometry args={[size[0] - 0.16, 0.025, 0.07]} />
      <meshBasicMaterial color={color} transparent opacity={0.82} />
    </mesh>
    {[-size[0] / 2, size[0] / 2].map((x) => <mesh key={x} position={[x, 0.068, 0]}>
      <boxGeometry args={[0.07, 0.025, size[1] - 0.16]} /><meshBasicMaterial color={color} transparent opacity={0.82} /></mesh>)}
  </group>;
}

function AisleMarks() {
  return <group>{Array.from({ length: 11 }, (_, i) => {
    const x = -18 + i * 3.6;
    return <group key={i} position={[x, 0.08, 0]}>
      <mesh position={[0.52, 0, 0]}><boxGeometry args={[0.8, 0.022, 0.052]} />
        <meshBasicMaterial color="#b1c1c1" transparent opacity={0.76} /></mesh>
      <mesh position={[1.02, 0, 0]} rotation-y={Math.PI / 4}><boxGeometry args={[0.17, 0.026, 0.085]} />
        <meshBasicMaterial color="#b1c1c1" transparent opacity={0.76} /></mesh>
    </group>;
  })}</group>;
}

function RouteArrow({ from, to, color }: {
  from: [number, number, number]; to: [number, number, number]; color: string;
}) {
  const direction = new THREE.Vector3(to[0] - from[0], 0, to[2] - from[2]).normalize();
  const position = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2] as [number, number, number];
  return <mesh position={position} rotation-y={Math.atan2(direction.x, direction.z)}>
    <coneGeometry args={[0.17, 0.42, 3]} /><meshBasicMaterial color={color} transparent opacity={0.9} />
  </mesh>;
}

function ProcessStation({ id, position, active }: { id: string; position: [number, number]; active: boolean }) {
  return <mesh name={`process-station-${id}`} position={[position[0], 0.19, position[1]]} rotation-x={-Math.PI / 2}>
    <ringGeometry args={[active ? 0.66 : 0.48, active ? 0.8 : 0.57, 32]} />
    <meshBasicMaterial color={active ? "#f2c86b" : "#9cf2d4"} transparent opacity={0.95} side={THREE.DoubleSide} />
  </mesh>;
}

function Roof({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <group>
    {[[-23.5, 6.3], [23.5, 6.3]].map(([x, z]) => <mesh key={`${x}:${z}`} position={[x, 6, z]}>
      <boxGeometry args={[0.28, 11.8, 0.28]} /><meshStandardMaterial color="#415157" metalness={0.64} roughness={0.39} /></mesh>)}
    {[-14, -5, 5, 14].map((z) => <mesh key={z} position={[0, 11.7, z]}>
      <boxGeometry args={[47, 0.22, 0.24]} /><meshStandardMaterial color="#45565d" metalness={0.69} roughness={0.37} /></mesh>)}
    {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[-20 + i * 5.7, 11.53, 0]}>
      <boxGeometry args={[3.15, 0.1, 18]} /><meshStandardMaterial color="#8a9998" transparent opacity={0.06} roughness={0.34} side={THREE.DoubleSide} /></mesh>)}
    {[[-10, 10.8], [0, 10.8], [10, 10.8]].map(([x, y]) => <mesh key={x} position={[x, y, 0]} rotation-x={Math.PI / 2}>
      <boxGeometry args={[0.08, 24, 0.08]} /><meshBasicMaterial color="#e3c37b" transparent opacity={0.12} /></mesh>)}
  </group>;
}

function Backdrop({ lang }: { lang: "zh" | "en" }) {
  return <>
    <color attach="background" args={["#0d1316"]} />
    <fog attach="fog" args={["#0d1316", 50, 90]} />
    <mesh position={[0, 4.1, -14.9]}>
      <boxGeometry args={[47.5, 8.2, 0.32]} /><meshStandardMaterial color="#252f33" roughness={0.83} /></mesh>
    <mesh position={[0, 8.28, -14.82]}>
      <boxGeometry args={[47.2, 0.16, 0.4]} /><meshStandardMaterial color="#526064" metalness={0.47} roughness={0.45} /></mesh>
    <WorldPlate name="wall-brand" position={[-18, 7.8, -14.68]} size={[5.8, 1.05]}
      title={lang === "zh" ? "精密制造 · 单元 A" : "PRECISION MACHINING · CELL A"} accent="#70d8b6" />
  </>;
}

function CameraRig({ view, controls, focusPosition, focusHeight, selectedId }: {
  view: ViewMode; controls: React.RefObject<any>; focusPosition?: [number, number];
  focusHeight: number; selectedId: string | null;
}) {
  const latest = useRef({ focusPosition, focusHeight });
  latest.current = { focusPosition, focusHeight };
  useLayoutEffect(() => {
    const control = controls.current;
    if (!control) return;
    const point = latest.current.focusPosition;
    const target = view === 'focus' && point
      ? new THREE.Vector3(point[0], latest.current.focusHeight, point[1]) : new THREE.Vector3();
    const eye = view === 'top' ? new THREE.Vector3(0, 60, 0.015)
      : view === 'focus' ? target.clone().add(selectedId === 'P001' ? new THREE.Vector3(4, 9, 8)
        : new THREE.Vector3(6, 5.2, selectedId?.startsWith('M0') ? -10 : 10))
      : new THREE.Vector3(35, 38, 43);
    control.minDistance = view === 'focus' ? 5 : 16;
    control.target.copy(target);
    control.object.position.copy(eye);
    control.update();
  }, [view, selectedId, controls]);
  useFrame(({ gl, camera }) => {
    const control = controls.current;
    if (view !== 'focus' || !focusPosition || !control) return;
    const target = new THREE.Vector3(focusPosition[0], focusHeight, focusPosition[1]);
    const shift = target.clone().sub(control.target);
    camera.position.add(shift);
    control.target.copy(target);
    control.update();
    const projected = target.clone().project(camera);
    gl.domElement.dataset.focusX = projected.x.toFixed(4);
    gl.domElement.dataset.focusY = projected.y.toFixed(4);
  });
  return null;
}

export function WorkshopScene({
  lang, state, selectedId, onSelect, showLabels, showRoutes, view, focusPosition, copy, onReady, production,
}: {
  lang: "zh" | "en"; state: SimulationState; selectedId: string | null;
  onSelect: (asset: WorkshopAsset) => void; showLabels: boolean; showRoutes: boolean;
  view: ViewMode; focusPosition?: [number, number]; copy: Copy; onReady: () => void;
  production?: ProductionSnapshot;
}) {
  const controls = useRef<any>(null);
  const carrierPose = processPose(state.elapsed);
  const productionPart = production?.parts.find(part => part.id === selectedId);
  const selectedAsset = productionPart ? { ...WORKPIECE_ASSET, id: productionPart.id }
    : selectedId === WORKPIECE_ASSET.id ? WORKPIECE_ASSET : ASSETS.find(({ id }) => id === selectedId);
  const focusPose = production ? productionAssetPose(production, selectedId ?? '')
    ?? (selectedAsset ? { position: selectedAsset.position, height: 1.5 } : undefined)
    : selectedAsset ? assetPose(selectedAsset, state.elapsed) : undefined;
  const zoneTitles: Record<string, string> = useMemo(() => Object.fromEntries(
    Object.entries(zoneLabels).map(([key, value]) => [key, lang === "zh" ? value.zh : value.en]),
  ), [lang]);
  return <Canvas shadows dpr={[1, 1.5]} camera={{ position: [35, 38, 43], fov: 34, near: 0.1, far: 130 }}
    gl={{ antialias: true, alpha: false }} onCreated={({ gl }) => {
      gl.setClearColor("#0d1316"); gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.08; onReady();
    }}>
    <Suspense fallback={null}>
      {view !== "top" && <Backdrop lang={lang} />}
      <ambientLight intensity={0.88} color="#cfdbd7" />
      <hemisphereLight args={["#c1d2da", "#303b3b", 1.25]} />
      <directionalLight position={[-18, 30, -17]} intensity={2.1} color="#e2ece9"
        castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={28} shadow-camera-bottom={-28} />
      <directionalLight position={[12, 14, 20]} intensity={0.56} color="#a5d5df" />
      <pointLight position={[-5, 10, 0]} intensity={40} distance={35} color="#78d7b4" />
      <pointLight position={[16, 9, 4]} intensity={32} distance={30} color="#76c4da" />
      <WorkshopFloor lang={lang} labels={showLabels} routes={showRoutes} production={!!production}
        activeStage={production ? productionPart?.stage_index ?? -1 : carrierPose.stageIndex} />
      {production && showRoutes && <ProductionRoutes snapshot={production} />}
      <Roof visible={view === "orbit" && !production} />
      {ASSETS.filter(({ kind }) => kind === "lathe" || kind === "mill").map((asset) => {
        const machine = state.machines[asset.id];
        const selected = selectedId === asset.id;
        const faulted = machine?.status === "fault";
        const active = !production || machine?.status === 'running';
        const onClick = () => onSelect(asset);
        return <group key={asset.id} position={[asset.position[0], 0, asset.position[1]]}>
          <group rotation-y={asset.kind === "lathe" ? Math.PI : 0}>
            {asset.kind === "lathe" ? <Lathe selected={selected} onSelect={onClick} faulted={faulted} active={active} elapsed={state.elapsed}
              cutaway /> :
              <Mill selected={selected} onSelect={onClick} faulted={faulted} active={active} elapsed={state.elapsed}
                cutaway />}
          </group>
          {showLabels && <TagFromParent asset={asset} zone={zoneTitles[asset.zone] ?? ""} selected={selected}
            status={machine?.status ?? "idle"} onSelect={onClick} copy={copy} />}
        </group>;
      })}
      {ROBOT_CELLS.map((cell, index) => {
        const asset = ASSETS.find(({ id }) => id === cell.id)!;
        const robot = production?.robots.find(item => item.id === cell.id);
        const pose = robot ? { position: [robot.position[0], robot.position[2]] as [number, number], machineId: robot.machine_id ?? '' } : robotPose(state.elapsed, index);
        const machine = state.machines[pose.machineId];
        const rotation = asset.id === "R01" ? Math.PI / 2 : -Math.PI / 2;
        return <group key={asset.id}>
          <RobotRail position={[-3, cell.trackZ]} />
          <Robot asset={asset} machine={machine} rotation={rotation} position={pose.position}
            elapsed={production && robot?.status === 'idle' ? 0 : state.elapsed} showLabels={showLabels}
            tip={production ? robot?.tip ?? undefined : PROCESS_STAGES[carrierPose.stageIndex].id === pose.machineId && ['load', 'unload'].includes(carrierPose.phase)
              ? carrierPose.workpiecePosition : undefined}
            selected={selectedId === asset.id} onSelect={() => onSelect(asset)} />
        </group>;
      })}
      {ASSETS.filter(({ kind }) => kind === "amr").map((asset, index) => {
        const carrier = production?.amrs.find(item => item.id === asset.id);
        const pose = carrier ? { position: [carrier.position[0], carrier.position[2]] as [number, number], heading: carrier.heading } : index === 0 ? carrierPose : amrPose(state.elapsed, index);
        return <AMR key={asset.id} asset={asset} position={pose.position} heading={pose.heading}
          carrying={false} showLabels={showLabels} elapsed={state.elapsed}
          selected={selectedId === asset.id} onSelect={() => onSelect(asset)} />;
      })}
      {production ? production.parts.map(part => <group key={part.id}>
        <MovingWorkpiece position={part.position} stage={part.stage_index}
          rotating={part.status === 'processing' && !production.machines.some(m => m.part_id === part.id && m.status === 'fault')}
          elapsed={state.elapsed} color={part.order_id === production.orders[0]?.id ? '#a4e6d0' : part.order_id === production.orders[1]?.id ? '#e9be79' : '#8fbfdf'}
          onSelect={() => onSelect({ ...WORKPIECE_ASSET, id: part.id, name: { zh: `工件 ${part.id}`, en: `Part ${part.id}` } })} />
        {selectedId === part.id && <mesh position={[part.position[0], part.position[1] - 0.3, part.position[2]]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.45, 0.53, 24]} /><meshBasicMaterial color="#eff9bc" side={THREE.DoubleSide} />
        </mesh>}
      </group>) : <MovingWorkpiece position={carrierPose.workpiecePosition} stage={carrierPose.stageIndex}
        rotating={carrierPose.phase === 'process'} elapsed={state.elapsed} onSelect={() => onSelect(WORKPIECE_ASSET)} />}
      {production?.bottlenecks.slice(0, 3).map((item, i) => { const asset = ASSETS.find(a => a.id === item.resource); return asset ? <mesh key={`${item.resource}-${i}`} position={[asset.position[0], 0.15, asset.position[1]]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[2.45, 2.55, 40]} /><meshBasicMaterial color="#e7a355" side={THREE.DoubleSide} transparent opacity={0.7} />
      </mesh> : null; })}
      {ASSETS.filter(({ kind }) => !["lathe", "mill", "robot", "amr"].includes(kind)).map((asset) =>
        <StaticAsset key={asset.id} asset={asset} showLabels={showLabels} selected={selectedId === asset.id} onSelect={() => onSelect(asset)} />)}
      <OrbitControls ref={controls} makeDefault enableDamping enablePan={view !== "focus"} dampingFactor={0.07} minPolarAngle={0.12}
        maxPolarAngle={Math.PI * 0.48} minDistance={16} maxDistance={75} target={[0, 0, 0]} />
      <CameraRig view={view} controls={controls} focusPosition={focusPose?.position}
        focusHeight={focusPose?.height ?? 1.5} selectedId={selectedId} />
    </Suspense>
  </Canvas>;
}

function TagFromParent({ asset, zone, selected, status, onSelect, copy }: {
  asset: WorkshopAsset; zone: string; selected: boolean; status: string;
  onSelect: () => void; copy: Copy;
}) {
  const colors: Record<string, string> = { running: "#57d5ad", setup: "#efb35a", idle: "#758894", fault: "#fa655b" };
  return <WorldPlate name={`machine-label-${asset.id}`} position={[asset.footprint[0] / 2 + 1.65, 0.18, 0]}
    rotation={[-Math.PI / 2, 0, 0]} size={[2.7, 0.66]} title={`${asset.id} · ${copy[status as keyof Copy] ?? status}`}
    detail={zone} accent={colors[status] ?? colors.idle} active={selected} onClick={onSelect} />;
}

function MovingWorkpiece({ position, stage, rotating, elapsed, onSelect, color = '#e8e6cf' }: {
  position: [number, number, number]; stage: number; rotating: boolean; elapsed: number; onSelect: () => void; color?: string;
}) {
  return <group name="tracked-workpiece" position={position} rotation-x={rotating ? elapsed * 3 : 0}
    onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <mesh castShadow rotation-z={Math.PI / 2}>
      <cylinderGeometry args={[stage < 2 ? 0.24 : 0.17, stage < 2 ? 0.24 : 0.17, 0.85, 24]} />
      <meshStandardMaterial color={color} metalness={0.8} roughness={0.22} emissive="#c49f48" emissiveIntensity={0.35} />
    </mesh>
    {stage >= 2 && [-0.24, 0.23].map((x) => <mesh key={x} position={[x, 0, 0]} rotation-z={Math.PI / 2}>
      <cylinderGeometry args={[0.26, 0.26, 0.12, 24]} />
      <meshStandardMaterial color="#c7d4cc" metalness={0.85} roughness={0.2} />
    </mesh>)}
  </group>;
}

function ProductionRoutes({ snapshot }: { snapshot: ProductionSnapshot }) {
  return <group>{snapshot.amrs.filter(amr => amr.path.length).map(amr => {
    const points = [amr.position, ...amr.path].map(([x, , z]) => [x, 0.2, z] as [number, number, number]);
    return <Line key={amr.id} points={points}
      color={amr.part_id ? '#7ce8bd' : '#81acc6'} lineWidth={2} dashed dashSize={0.5} gapSize={0.3} />;
  })}</group>;
}
