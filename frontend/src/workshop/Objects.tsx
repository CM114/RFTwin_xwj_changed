import { Html } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { MachineModel, WorkshopAsset } from "./model";

const statusColor = {
  running: "#52d6ad", setup: "#efb35a", idle: "#768995", fault: "#fa655b",
} as const;

function Tag({ asset, active, onSelect }: {
  asset: WorkshopAsset; active: boolean; onSelect: (asset: WorkshopAsset) => void;
}) {
  const color = statusColor[asset.kind === "lathe" || asset.kind === "mill" ? "running" : "idle"];
  return (
    <Html position={[0, 0.65, 0]} center distanceFactor={40} occlude={false}>
      <button className={`scene-tag${active ? " is-active" : ""}`} data-testid={`scene-pick-${asset.id}`}
        onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSelect(asset); }}>
        <span className="tag-light" style={{ background: color }} />{asset.id}
      </button>
    </Html>
  );
}

export function Lathe({ selected, onSelect, faulted = false }: {
  selected: boolean; onSelect: () => void; faulted?: boolean;
}) {
  const status = faulted ? statusColor.fault : statusColor.running;
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <mesh castShadow position={[0, 1.52, 0]}>
        <boxGeometry args={[4.15, 2.8, 3.45]} />
        <meshStandardMaterial color={faulted ? "#69403b" : "#405761"} metalness={0.45} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[-0.08, 3.02, 0]}>
        <boxGeometry args={[4.25, 0.18, 3.55]} />
        <meshStandardMaterial color="#80939a" metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0.28, 1.58, -1.74]}>
        <boxGeometry args={[2.75, 1.75, 0.055]} />
        <meshStandardMaterial color="#16333c" emissive="#0d252e" emissiveIntensity={0.7} metalness={0.1} roughness={0.18} />
      </mesh>
      <mesh castShadow position={[0.27, 1.58, -1.78]}>
        <boxGeometry args={[2.56, 1.55, 0.04]} />
        <meshStandardMaterial color="#4f777c" transparent opacity={0.45} metalness={0.35} roughness={0.17} />
      </mesh>
      <mesh castShadow position={[-1.72, 1.48, -1.94]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.7, 0.7, 0.32, 32]} />
        <meshStandardMaterial color="#a5b0b3" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh castShadow position={[-1.72, 1.48, -2.11]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.4, 0.4, 0.11, 24]} />
        <meshStandardMaterial color="#44535a" metalness={0.8} roughness={0.28} />
      </mesh>
      <mesh position={[0.9, 1.7, -1.98]}>
        <boxGeometry args={[0.58, 1.18, 0.18]} />
        <meshStandardMaterial color="#26373e" metalness={0.15} roughness={0.65} />
      </mesh>
      <ControlPanel faulted={faulted} position={[-1.47, 1.12, -2.02]} />
      <SignalTower position={[1.55, 3.25, -1.15]} status={status} />
      {selected && <SelectionHalo color="#70e5ce" />}
    </group>
  );
}

export function Mill({ selected, onSelect, faulted = false }: {
  selected: boolean; onSelect: () => void; faulted?: boolean;
}) {
  const status = faulted ? statusColor.fault : statusColor.running;
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <mesh castShadow position={[0, 1.55, 0]}>
        <boxGeometry args={[4.12, 2.9, 3.55]} />
        <meshStandardMaterial color={faulted ? "#69403b" : "#3c505b"} metalness={0.47} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 3.11, 0]}>
        <boxGeometry args={[4.22, 0.16, 3.65]} />
        <meshStandardMaterial color="#798d98" metalness={0.58} roughness={0.32} />
      </mesh>
      <mesh position={[0.32, 1.8, -1.79]}>
        <boxGeometry args={[2.55, 1.84, 0.06]} />
        <meshStandardMaterial color="#1b343e" emissive="#15333c" emissiveIntensity={0.4} metalness={0.35} roughness={0.18} />
      </mesh>
      <mesh castShadow position={[0.32, 1.78, -1.83]}>
        <boxGeometry args={[2.34, 1.62, 0.04]} />
        <meshStandardMaterial color="#658387" transparent opacity={0.42} metalness={0.35} roughness={0.2} />
      </mesh>
      <mesh castShadow position={[-1.48, 2.63, -1.92]}>
        <boxGeometry args={[0.18, 0.62, 0.24]} />
        <meshStandardMaterial color="#bdc7c6" metalness={0.78} roughness={0.24} />
      </mesh>
      <mesh castShadow position={[-1.48, 1.54, -1.92]}>
        <boxGeometry args={[0.8, 0.12, 0.16]} />
        <meshStandardMaterial color="#aab8b7" metalness={0.82} roughness={0.28} />
      </mesh>
      <ControlPanel faulted={faulted} position={[-1.47, 1.04, -2.02]} />
      <SignalTower position={[1.58, 3.34, -1.17]} status={status} />
      {selected && <SelectionHalo color="#70e5ce" />}
    </group>
  );
}

function ControlPanel({ faulted, position }: { faulted: boolean; position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow><boxGeometry args={[0.7, 0.88, 0.14]} />
        <meshStandardMaterial color="#d1d9d5" metalness={0.48} roughness={0.38} /></mesh>
      <mesh position={[0, 0.16, 0.078]}><boxGeometry args={[0.43, 0.25, 0.018]} />
        <meshStandardMaterial color="#132d32" emissive="#25634f" emissiveIntensity={0.5} /></mesh>
      <mesh position={[-0.14, -0.15, 0.08]}><cylinderGeometry args={[0.045, 0.045, 0.025, 12]} />
        <meshStandardMaterial color={faulted ? "#ff605d" : "#5bd4a9"} emissive={faulted ? "#ff3d37" : "#27af7e"} emissiveIntensity={1.4} /></mesh>
      <mesh position={[0.03, -0.15, 0.08]}><cylinderGeometry args={[0.045, 0.045, 0.025, 12]} />
        <meshStandardMaterial color="#e9b658" emissive="#bd791d" emissiveIntensity={0.65} /></mesh>
    </group>
  );
}

function SignalTower({ position, status }: { position: [number, number, number]; status: string }) {
  return <group position={position}>
    <mesh><cylinderGeometry args={[0.06, 0.08, 0.38, 12]} /><meshStandardMaterial color="#687981" metalness={0.7} /></mesh>
    <mesh position={[0, 0.25, 0]}><sphereGeometry args={[0.105, 14, 10]} />
      <meshStandardMaterial color={status} emissive={status} emissiveIntensity={1.1} /></mesh>
  </group>;
}

function SelectionHalo({ color }: { color: string }) {
  return <mesh position={[0, 0.045, 0]} rotation-x={-Math.PI / 2}>
    <ringGeometry args={[2.2, 2.32, 64]} /><meshBasicMaterial color={color} transparent opacity={0.95} side={THREE.DoubleSide} />
  </mesh>;
}

export function Robot({ asset, machine, rotation, selected, onSelect }: {
  asset: WorkshopAsset; machine: MachineModel; rotation: number; selected: boolean; onSelect: () => void;
}) {
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const progress = useRef(0.4);
  useFrame((_, delta) => {
    if (machine.status === "fault" || machine.status === "idle") return;
    progress.current += delta * (machine.status === "setup" ? 0.13 : 0.48);
    const t = progress.current;
    if (shoulder.current) shoulder.current.rotation.z = -0.5 + Math.sin(t) * 0.3;
    if (elbow.current) elbow.current.rotation.z = 0.7 + Math.sin(t + 0.9) * 0.48;
  });
  const body = "#e5a648";
  return <group position={[asset.position[0], 0, asset.position[1]]} rotation-y={rotation} onClick={(event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation(); onSelect();
  }}>
    <mesh castShadow position={[0, 0.22, 0]}><cylinderGeometry args={[0.58, 0.68, 0.44, 24]} />
      <meshStandardMaterial color="#36434a" metalness={0.7} roughness={0.35} /></mesh>
    <mesh position={[0, 0.48, 0]}><cylinderGeometry args={[0.14, 0.14, 0.1, 20]} />
      <meshStandardMaterial color="#52d6ad" emissive="#52d6ad" emissiveIntensity={0.75} /></mesh>
    <group ref={shoulder} position={[0, 0.62, 0]}>
      <mesh castShadow position={[0.52, 0.53, 0]} rotation-z={-0.62}>
        <boxGeometry args={[1.38, 0.32, 0.34]} /><meshStandardMaterial color={body} metalness={0.48} roughness={0.32} /></mesh>
      <mesh castShadow position={[1.04, 0.99, 0]}><sphereGeometry args={[0.27, 18, 14]} />
        <meshStandardMaterial color="#596c72" metalness={0.73} roughness={0.28} /></mesh>
      <group ref={elbow} position={[1.04, 0.99, 0]}>
        <mesh castShadow position={[0.6, 0.15, 0]} rotation-z={0.25}>
          <boxGeometry args={[1.25, 0.24, 0.25]} /><meshStandardMaterial color={body} metalness={0.5} roughness={0.32} /></mesh>
        <mesh castShadow position={[1.18, 0.31, 0]} rotation-z={0.55}>
          <boxGeometry args={[0.39, 0.11, 0.17]} /><meshStandardMaterial color="#48585e" metalness={0.75} roughness={0.27} /></mesh>
        <mesh position={[1.34, 0.39, 0]}><sphereGeometry args={[0.055, 12, 10]} />
          <meshStandardMaterial color={machine.status === "fault" ? "#fa655b" : "#71e1c1"} emissive="#2aab87" emissiveIntensity={1.1} /></mesh>
      </group>
    </group>
    {selected && <SelectionHalo color="#70e5ce" />}
    <Tag asset={asset} active={selected} onSelect={() => onSelect()} />
  </group>;
}

export function AMR({ asset, position, heading, selected, onSelect }: {
  asset: WorkshopAsset; position: [number, number]; heading: number; selected: boolean; onSelect: () => void;
}) {
  return <group position={[position[0], 0, position[1]]} rotation-y={-heading}
    onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
    <mesh castShadow position={[0, 0.23, 0]}><boxGeometry args={[1.25, 0.35, 0.84]} />
      <meshStandardMaterial color="#38c3b3" metalness={0.46} roughness={0.34} /></mesh>
    <mesh castShadow position={[-0.18, 0.44, -0.08]}><boxGeometry args={[0.47, 0.17, 0.56]} />
      <meshStandardMaterial color="#17272b" metalness={0.38} roughness={0.26} /></mesh>
    <mesh position={[0.42, 0.49, -0.03]}><boxGeometry args={[0.16, 0.12, 0.14]} />
      <meshStandardMaterial color="#d5f6dc" emissive="#63f0a9" emissiveIntensity={1.25} /></mesh>
    <mesh position={[0.62, 0.59, 0]}><cylinderGeometry args={[0.12, 0.12, 0.09, 16]} />
      <meshStandardMaterial color="#b6c6be" metalness={0.84} roughness={0.22} /></mesh>
    {[[-0.42, -0.31], [-0.42, 0.31], [0.42, -0.31], [0.42, 0.31]].map(([x, z]) =>
      <mesh key={`${x}:${z}`} position={[x, 0.13, z]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.09, 0.09, 0.08, 14]} /><meshStandardMaterial color="#11191c" /></mesh>)}
    {selected && <SelectionHalo color="#70e5ce" />}
    <Tag asset={asset} active={selected} onSelect={onSelect} />
  </group>;
}

export function StaticAsset({ asset, selected, onSelect }: {
  asset: WorkshopAsset; selected: boolean; onSelect: () => void;
}) {
  const { kind, footprint } = asset;
  const [w, d] = footprint;
  const base = { raw: "#718887", finished: "#638c78", buffer: "#94764a", hold: "#b37451", rework: "#916e4b",
    deburr: "#58747b", washer: "#586b7e", inspection: "#62878c", tooling: "#6b7271", maintenance: "#806a51",
    charger: "#387f72" } as const;
  const height = kind === "charger" ? 0.15 : kind === "raw" || kind === "finished" || kind === "buffer" ? 0.12 : 1.25;
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: base[kind as keyof typeof base] ?? "#647983", roughness: 0.7, metalness: 0.12 }), [kind]);
  return <group position={[asset.position[0], 0, asset.position[1]]}
    onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
    <mesh position={[0, 0.035, 0]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[w + 0.35, d + 0.35]} /><meshStandardMaterial color={selected ? "#1b554a" : "#233239"} emissive={selected ? "#174c40" : "#0b1114"} emissiveIntensity={0.3} /></mesh>
    {kind === "raw" || kind === "finished" ? <PalletStock w={w} d={d} color={material.color} /> :
      kind === "buffer" ? <BufferSlots w={w} d={d} /> :
      kind === "charger" ? <ChargePad w={w} d={d} /> : <WorkStation kind={kind} w={w} d={d} height={height} material={material} />}
    {selected && <SelectionHalo color="#70e5ce" />}
    <Tag asset={asset} active={selected} onSelect={onSelect} />
  </group>;
}

function PalletStock({ w, d, color }: { w: number; d: number; color: THREE.Color }) {
  const count = 3;
  return <group>{Array.from({ length: count }, (_, index) => {
    const x = (index - 1) * Math.min(1.15, w / 4);
    return <group key={index} position={[x, 0.14, 0]}>
      <mesh castShadow><boxGeometry args={[0.94, 0.22, Math.min(d * 0.5, 1.3)]} /><meshStandardMaterial color="#9d8059" roughness={0.85} /></mesh>
      {[0, 1, 2].map((layer) => <mesh key={layer} castShadow position={[0, 0.18 + layer * 0.15, 0]}>
        <boxGeometry args={[0.74, 0.27, Math.min(d * 0.38, 0.9)]} />
        <meshStandardMaterial color={color} roughness={0.52} metalness={0.22} /></mesh>)}
    </group>;
  })}</group>;
}

function BufferSlots({ w, d }: { w: number; d: number }) {
  const count = 3;
  return <group>{Array.from({ length: count }, (_, index) => <group key={index} position={[(index - 1) * w * 0.29, 0, 0]}>
    <mesh position={[0, 0.07, 0]}><boxGeometry args={[w * 0.25, 0.1, d * 0.8]} />
      <meshStandardMaterial color="#849398" metalness={0.68} roughness={0.32} /></mesh>
    <mesh position={[0, 0.42, 0]} castShadow><boxGeometry args={[0.7, 0.58, 0.53]} />
      <meshStandardMaterial color="#9e8555" metalness={0.2} roughness={0.5} /></mesh>
  </group>)}</group>;
}

function ChargePad({ w, d }: { w: number; d: number }) {
  return <group>
    <mesh position={[0, 0.045, 0]}><boxGeometry args={[w * 0.88, 0.07, d * 0.85]} />
      <meshStandardMaterial color="#254f48" emissive="#1d594b" emissiveIntensity={0.55} metalness={0.36} /></mesh>
    <mesh position={[0, 0.09, 0]}><boxGeometry args={[w * 0.64, 0.025, 0.08]} />
      <meshStandardMaterial color="#6ee4b8" emissive="#48cf9f" emissiveIntensity={1.2} /></mesh>
    <mesh position={[0, 0.18, -d * 0.32]}><boxGeometry args={[0.12, 0.2, 0.12]} />
      <meshStandardMaterial color="#74dbc0" emissive="#328e77" emissiveIntensity={1} /></mesh>
  </group>;
}

function WorkStation({ kind, w, d, height, material }: {
  kind: string; w: number; d: number; height: number; material: THREE.Material;
}) {
  const storage = kind === "tooling" || kind === "maintenance";
  const columns = storage ? 3 : 2;
  const rows = storage ? 2 : 1;
  return <group>{Array.from({ length: columns * rows }, (_, i) => {
    const x = ((i % columns) - (columns - 1) / 2) * Math.min(w / columns, 1.25);
    const z = (Math.floor(i / columns) - (rows - 1) / 2) * Math.min(d * 0.34, 1.0);
    return <group key={i} position={[x, 0, z]}>
      {storage ? <StorageRack height={height} material={material} /> :
        <group>
          <mesh castShadow position={[0, height / 2, 0]}><boxGeometry args={[Math.min(w * 0.36, 1.35), height, Math.min(d * 0.46, 1.45)]} />
            <primitive object={material} attach="material" /></mesh>
          <mesh castShadow position={[0, height + 0.1, 0]}><boxGeometry args={[Math.min(w * 0.39, 1.48), 0.18, Math.min(d * 0.49, 1.58)]} />
            <meshStandardMaterial color="#bdc7c0" metalness={0.65} roughness={0.36} /></mesh>
          {kind === "inspection" && <MeasureGauge />}
          {kind === "washer" && <mesh position={[0, height * 0.66, 0.74]}>
            <torusGeometry args={[0.22, 0.05, 8, 18]} /><meshStandardMaterial color="#aab8b1" metalness={0.85} /></mesh>}
          {kind === "deburr" && <mesh castShadow position={[0.2, height + 0.3, 0]}>
            <cylinderGeometry args={[0.22, 0.28, 0.48, 16]} /><meshStandardMaterial color="#343d40" metalness={0.7} /></mesh>}
        </group>}
    </group>;
  })}</group>;
}

function StorageRack({ height, material }: { height: number; material: THREE.Material }) {
  return <group>
    <mesh castShadow position={[0, height / 2, 0]}><boxGeometry args={[0.11, height, 0.12]} /><primitive object={material} attach="material" /></mesh>
    {[-0.4, 0.35, 0.8].map((y) => <mesh key={y} castShadow position={[0.15, y, 0]}>
      <boxGeometry args={[0.76, 0.1, 0.7]} /><meshStandardMaterial color="#718188" metalness={0.57} roughness={0.38} /></mesh>)}
    <mesh castShadow position={[0.15, 0.04, 0]}><boxGeometry args={[0.58, 0.56, 0.53]} />
      <meshStandardMaterial color="#d3a754" roughness={0.78} /></mesh>
  </group>;
}

function MeasureGauge() {
  return <group position={[0.1, 1.15, 0]}>
    <mesh castShadow position={[0, 0.33, 0]}><boxGeometry args={[0.15, 0.1, 0.86]} />
      <meshStandardMaterial color="#b9c9c4" metalness={0.86} roughness={0.2} /></mesh>
    <mesh castShadow position={[0, 0.05, -0.34]}><boxGeometry args={[0.14, 0.62, 0.12]} />
      <meshStandardMaterial color="#aebbb5" metalness={0.78} roughness={0.25} /></mesh>
    <mesh castShadow position={[0, 0.05, 0.34]}><boxGeometry args={[0.14, 0.62, 0.12]} />
      <meshStandardMaterial color="#aebbb5" metalness={0.78} roughness={0.25} /></mesh>
    <mesh castShadow position={[0, 0.02, 0]}><cylinderGeometry args={[0.18, 0.18, 0.12, 20]} />
      <meshStandardMaterial color="#c48a48" metalness={0.8} roughness={0.27} /></mesh>
  </group>;
}

export function ZoneSign({ position, label, color }: {
  position: [number, number]; label: string; color: string;
}) {
  return <group position={[position[0], 0, position[1]]}>
    <mesh position={[0, 1.15, 0]}><boxGeometry args={[3.6, 0.56, 0.11]} />
      <meshStandardMaterial color="#18252a" metalness={0.28} roughness={0.45} /></mesh>
    <mesh position={[-1.64, 1.15, 0.07]}><boxGeometry args={[0.045, 0.29, 0.012]} />
      <meshBasicMaterial color={color} /></mesh>
    <Html position={[0, 1.16, 0.08]} center distanceFactor={30} occlude={false}>
      <div className="zone-sign">{label}</div>
    </Html>
    {[-1.6, 1.6].map((x) => <mesh key={x} position={[x, 0.53, 0]}>
      <boxGeometry args={[0.09, 1.05, 0.09]} /><meshStandardMaterial color="#47585d" metalness={0.5} /></mesh>)}
  </group>;
}
