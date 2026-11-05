import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Copy } from "./copy";
import { AMR, Lathe, Mill, Robot, StaticAsset, ZoneSign } from "./Objects";
import { AMR_PATH, ASSETS } from "./model";
import type { SimulationState, WorkshopAsset } from "./model";

type ViewMode = "orbit" | "top";

const zoneLabels = {
  raw: { zh: "01 原料收货", en: "01 RECEIVING & STOCK", color: "#d2a75a" },
  turning: { zh: "02 数控车削", en: "02 CNC TURNING", color: "#5bcfbc" },
  milling: { zh: "03 加工中心", en: "03 MACHINING CENTERS", color: "#5bcfbc" },
  post: { zh: "04 去毛刺 · 清洗", en: "04 FINISHING", color: "#73b8d1" },
  quality: { zh: "05 尺寸检验", en: "05 QUALITY CONTROL", color: "#8bc9b0" },
  finished: { zh: "06 包装发运", en: "06 PACKING & SHIP", color: "#d2a75a" },
  support: { zh: "工装 · 维修支持", en: "TOOLING · MAINTENANCE", color: "#9aabb2" },
} as const;

function WorkshopFloor({ lang, labels, routes }: {
  lang: "zh" | "en"; labels: boolean; routes: boolean;
}) {
  const routeA = useMemo(() => [
    [-20, 0.13, -8], [-12, 0.13, -8], [-3, 0.13, -8], [14, 0.13, 8],
    [20, 0.13, 8], [13, 0.13, -8], [20, 0.13, -8],
  ] as [number, number, number][], []);
  const routeB = useMemo(() => [
    [-20, 0.16, -8], [-3, 0.16, -8], [14, 0.16, 8], [13, 0.16, -8], [20, 0.16, -8],
  ] as [number, number, number][], []);
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
    <FloorBay position={[-12, -8]} size={[14, 7.2]} color="#54cdb7" />
    <FloorBay position={[-2, 8]} size={[14, 7.2]} color="#61aed0" />
    <FloorBay position={[17.5, 8]} size={[11.8, 7.2]} color="#82c8b0" />
    <FloorBay position={[-20, -8]} size={[5.4, 8]} color="#d4ad69" />
    <FloorBay position={[20, -8]} size={[5.4, 7]} color="#d4ad69" />
    <FloorBay position={[-20, 9.8]} size={[5.4, 9]} color="#9aadb2" />
    {routes && <>
      <Line points={routeA} color="#77dfb9" lineWidth={2.1} dashed dashSize={0.5} gapSize={0.36} />
      <Line points={routeB} color="#78cce5" lineWidth={1.6} dashed dashSize={0.28} gapSize={0.38} />
      <RouteArrow from={[-17, 0.16, -8]} to={[-14.8, 0.16, -8]} color="#77dfb9" />
      <RouteArrow from={[-0.6, 0.16, -8]} to={[1.1, 0.16, -8]} color="#77dfb9" />
      <RouteArrow from={[13.1, 0.18, 8]} to={[13.7, 0.18, 7.2]} color="#77dfb9" />
      <RouteArrow from={[17.5, 0.16, -8]} to={[19, 0.16, -8]} color="#78cce5" />
    </>}
    <AisleMarks />
    {labels && Object.entries(zoneLabels).map(([zone, entry]) => {
      const places: Record<string, [number, number]> = {
        raw: [-20, -13.45], turning: [-10, -4.6], milling: [-2, 12.65], post: [17, 4.1],
        quality: [13, -11.2], finished: [20, -12.45], support: [-20, 14],
      };
      return <ZoneSign key={zone} position={places[zone]} label={lang === "zh" ? entry.zh : entry.en} color={entry.color} />;
    })}
    {labels && <Html position={[0, 0.12, -1.48]} center distanceFactor={38} occlude={false}>
      <span className="aisle-label">{lang === "zh" ? "AGV · AMR 共用物流通道" : "AGV · AMR LOGISTICS AISLE"}</span>
    </Html>}
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
    <Html position={[-18, 7.8, -14.68]} transform distanceFactor={28} occlude={false}>
      <div className="wall-brand">{lang === "zh" ? "精密制造 · 单元 A" : "PRECISION MACHINING · CELL A"}</div>
    </Html>
  </>;
}

function CameraRig({ view, controls }: { view: ViewMode; controls: React.RefObject<any> }) {
  const eye = useMemo(() => view === "top"
    ? new THREE.Vector3(0, 60, 0.015)
    : new THREE.Vector3(35, 38, 43), [view]);
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  useEffect(() => {
    const control = controls.current;
    if (!control) return;
    control.target.copy(target);
    control.object.position.copy(eye);
    control.update();
  }, [view, controls, eye, target]);
  return null;
}

export function WorkshopScene({
  lang, state, selectedId, onSelect, showLabels, showRoutes, view, copy, onReady,
}: {
  lang: "zh" | "en"; state: SimulationState; selectedId: string | null;
  onSelect: (asset: WorkshopAsset) => void; showLabels: boolean; showRoutes: boolean;
  view: ViewMode; copy: Copy; onReady: () => void;
}) {
  const controls = useRef<any>(null);
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
      <WorkshopFloor lang={lang} labels={showLabels} routes={showRoutes} />
      <Roof visible={view !== "top"} />
      {ASSETS.filter(({ kind }) => kind === "lathe" || kind === "mill").map((asset) => {
        const machine = state.machines[asset.id];
        const selected = selectedId === asset.id;
        const faulted = machine?.status === "fault";
        const onClick = () => onSelect(asset);
        return <group key={asset.id} position={[asset.position[0], 0, asset.position[1]]}>
          <group rotation-y={Math.PI}>
            {asset.kind === "lathe" ? <Lathe selected={selected} onSelect={onClick} faulted={faulted} /> :
              <Mill selected={selected} onSelect={onClick} faulted={faulted} />}
          </group>
          {showLabels && <TagFromParent asset={asset} zone={zoneTitles[asset.zone] ?? ""} selected={selected}
            status={machine?.status ?? "idle"} onSelect={onClick} copy={copy} />}
        </group>;
      })}
      {ASSETS.filter(({ kind }) => kind === "robot").map((asset, index) => {
        const machine = state.machines[index === 0 ? "L01" : "M01"];
        const rotation = asset.id === "R01" ? Math.PI / 2 : -Math.PI / 2;
        return <Robot key={asset.id} asset={asset} machine={machine} rotation={rotation}
          selected={selectedId === asset.id} onSelect={() => onSelect(asset)} />;
      })}
      {ASSETS.filter(({ kind }) => kind === "amr").map((asset, index) => <AMR key={asset.id} asset={asset}
        position={amrPose(state.elapsed, index).position} heading={amrPose(state.elapsed, index).heading}
        selected={selectedId === asset.id} onSelect={() => onSelect(asset)} />)}
      {ASSETS.filter(({ kind }) => !["lathe", "mill", "robot", "amr"].includes(kind)).map((asset) =>
        <StaticAsset key={asset.id} asset={asset} selected={selectedId === asset.id} onSelect={() => onSelect(asset)} />)}
      {showLabels && ASSETS.filter(({ kind }) => kind === "buffer").map((asset) => <Html key={`buf-${asset.id}`}
        position={[asset.position[0], 1.05, asset.position[1]]} center distanceFactor={32} occlude={false}>
        <span className="buffer-number">{asset.id}</span>
      </Html>)}
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.07} minPolarAngle={0.12}
        maxPolarAngle={Math.PI * 0.48} minDistance={16} maxDistance={75} target={[0, 0, 0]} />
      <CameraRig view={view} controls={controls} />
    </Suspense>
  </Canvas>;
}

function TagFromParent({ asset, zone, selected, status, onSelect, copy }: {
  asset: WorkshopAsset; zone: string; selected: boolean; status: string;
  onSelect: () => void; copy: Copy;
}) {
  const colors: Record<string, string> = { running: "#57d5ad", setup: "#efb35a", idle: "#758894", fault: "#fa655b" };
  return <Html position={[0, 3.56, 0]} center distanceFactor={37} occlude={false}>
    <button className={`machine-label${selected ? " is-active" : ""}`} data-testid={`scene-pick-${asset.id}`}
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      <span className="machine-label-id"><i style={{ background: colors[status] ?? colors.idle }} />{asset.id}</span>
      <span className="machine-label-status">{copy[status as keyof Copy] ?? status}</span>
      <span className="machine-label-zone">{zone}</span>
    </button>
  </Html>;
}

function amrPose(elapsed: number, index: number) {
  const distance = 88.8, speed = 1.2;
  let t = ((Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0) * speed + index * distance / 2) % distance;
  const points = AMR_PATH;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (t <= length) {
      const ratio = length ? t / length : 0;
      return { position: [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio] as [number, number],
        heading: Math.atan2(to[1] - from[1], to[0] - from[0]) };
    }
    t -= length;
  }
  return { position: [points[0][0], points[0][1]] as [number, number], heading: 0 };
}
