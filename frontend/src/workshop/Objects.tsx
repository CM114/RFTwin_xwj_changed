import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { MachineModel, WorkshopAsset } from "./model";

const statusColor = {
  running: "#52d6ad", setup: "#efb35a", idle: "#768995", fault: "#fa655b",
} as const;

export function WorldPlate({ position, rotation = [0, 0, 0], size, title, detail = "", accent, active = false,
  onClick, name }: {
  position: [number, number, number]; rotation?: [number, number, number]; size: [number, number];
  title: string; detail?: string; accent: string; active?: boolean; onClick?: () => void; name?: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = detail ? 144 : 96;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);
    context.fillStyle = active ? "#173a34" : "#172226";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = accent;
    context.fillRect(0, 0, 8, canvas.height);
    context.fillStyle = "#e3ece6";
    context.textBaseline = "middle";
    let titleSize = 66;
    context.font = `600 ${titleSize}px Arial, 'Microsoft YaHei', sans-serif`;
    while (titleSize > 30 && context.measureText(title).width > 465) {
      titleSize -= 2;
      context.font = `600 ${titleSize}px Arial, 'Microsoft YaHei', sans-serif`;
    }
    context.fillText(title, 25, detail ? 49 : 48, 465);
    if (detail) {
      context.fillStyle = "#91a39a";
      context.font = "36px Arial, 'Microsoft YaHei', sans-serif";
      context.fillText(detail, 25, 105, 465);
    }
    context.strokeStyle = active ? accent : "#52625e";
    context.lineWidth = 3;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    return next;
  }, [active, accent, detail, title]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh name={name} position={position} rotation={rotation} onClick={onClick ? (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation(); onClick();
  } : undefined}>
    <planeGeometry args={size} />
    <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
  </mesh>;
}

function Tag({ asset, active, onSelect, position }: {
  asset: WorkshopAsset; active: boolean; onSelect: (asset: WorkshopAsset) => void;
  position?: [number, number, number];
}) {
  const color = statusColor[asset.kind === "lathe" || asset.kind === "mill" ? "running" : "idle"];
  const z = position?.[2] ?? asset.footprint[1] / 2 + 0.16;
  return <WorldPlate name={`asset-label-${asset.id}`} position={position ?? [0, 0.16, z]}
    rotation={[-Math.PI / 2, 0, 0]} size={[2.45, 0.62]} title={asset.id} detail={asset.name.zh}
    accent={color} active={active} onClick={() => onSelect(asset)} />;
}

export function Lathe({ selected, onSelect, faulted = false, cutaway = false, elapsed = 0 }: {
  selected: boolean; onSelect: () => void; faulted?: boolean; cutaway?: boolean; elapsed?: number;
}) {
  const spindle = useRef<THREE.Group>(null);
  const tool = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const status = faulted ? statusColor.fault : statusColor.running;
  useFrame((_, delta) => {
    if (faulted) return;
    progress.current = elapsed;
    if (spindle.current) spindle.current.rotation.z = elapsed * 4.2;
    if (tool.current) tool.current.position.x = -1.08 + Math.sin(progress.current * 0.65) * 0.24;
  });
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <mesh castShadow position={[0, 0.25, 0]}><boxGeometry args={[4.15, 0.5, 3.45]} />
        <meshStandardMaterial color="#34464f" metalness={0.54} roughness={0.4} /></mesh>
      {[-1.88, 1.88].map((x) => <mesh key={x} castShadow position={[x, 1.58, 0]}>
        <boxGeometry args={[0.42, 2.6, 3.42]} />
        <meshStandardMaterial color={faulted ? "#69403b" : "#405761"} metalness={0.48} roughness={0.39} /></mesh>)}
      <mesh castShadow position={[0, 1.58, 1.54]}><boxGeometry args={[3.62, 2.6, 0.34]} />
        <meshStandardMaterial color="#354851" metalness={0.45} roughness={0.42} /></mesh>
      {!cutaway && <mesh castShadow position={[0, 2.91, 0]}><boxGeometry args={[4.16, 0.44, 3.45]} />
        <meshStandardMaterial color="#405761" metalness={0.48} roughness={0.36} /></mesh>}
      {[-1.38, 1.38].map((x) => <mesh key={`door-${x}`} position={[x, 1.58, -1.71]}>
        <boxGeometry args={[0.12, 2.18, 0.12]} /><meshStandardMaterial color="#a7b4b3" metalness={0.78} roughness={0.3} /></mesh>)}
      {!cutaway && <mesh castShadow position={[-0.08, 3.02, 0]}>
        <boxGeometry args={[4.25, 0.18, 3.55]} />
        <meshStandardMaterial color="#80939a" metalness={0.55} roughness={0.35} />
      </mesh>}
      <mesh position={[0.28, 1.58, -1.74]}>
        <boxGeometry args={[2.75, 1.75, 0.055]} />
        <meshStandardMaterial color="#17333b" transparent opacity={0.16} metalness={0.1} roughness={0.18} />
      </mesh>
      <mesh castShadow position={[0.27, 1.58, -1.78]}>
        <boxGeometry args={[2.56, 1.55, 0.04]} />
        <meshStandardMaterial color="#6b9b9b" transparent opacity={0.12} metalness={0.28} roughness={0.17} />
      </mesh>
      <group ref={spindle} position={[-1.72, 1.48, -1.94]}>
        <mesh castShadow rotation-x={Math.PI / 2}><cylinderGeometry args={[0.7, 0.7, 0.32, 32]} />
          <meshStandardMaterial color="#a5b0b3" metalness={0.85} roughness={0.25} /></mesh>
        <mesh castShadow position={[0, 0, -0.18]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.4, 0.4, 0.11, 24]} /><meshStandardMaterial color="#44535a" metalness={0.8} roughness={0.28} /></mesh>
        <mesh castShadow position={[0, 0, 0.47]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.16, 0.16, 0.88, 20]} /><meshStandardMaterial color="#c6d1cf" metalness={0.9} roughness={0.2} /></mesh>
      </group>
      <group ref={tool} position={[-1.08, 1.62, -1.25]}>
        <mesh castShadow position={[0, -0.25, 0]}><boxGeometry args={[0.68, 0.34, 0.72]} />
          <meshStandardMaterial color="#52646a" metalness={0.75} roughness={0.3} /></mesh>
        <mesh castShadow position={[0, 0.03, -0.13]} rotation-z={-0.35}>
          <boxGeometry args={[0.16, 0.42, 0.2]} /><meshStandardMaterial color="#d0ad69" metalness={0.85} roughness={0.22} /></mesh>
        <mesh position={[0, 0.03, -0.25]}><sphereGeometry args={[0.06, 12, 10]} />
          <meshStandardMaterial color="#7ee5c5" emissive="#64dfb8" emissiveIntensity={1.3} /></mesh>
      </group>
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

export function Mill({ selected, onSelect, faulted = false, cutaway = false, elapsed = 0 }: {
  selected: boolean; onSelect: () => void; faulted?: boolean; cutaway?: boolean; elapsed?: number;
}) {
  const spindleHead = useRef<THREE.Group>(null);
  const table = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const status = faulted ? statusColor.fault : statusColor.running;
  useFrame((_, delta) => {
    if (faulted) return;
    progress.current = elapsed;
    if (spindleHead.current) {
      spindleHead.current.position.y = 2.2 + Math.sin(progress.current * 0.7) * 0.23;
      spindleHead.current.rotation.y = elapsed * 4.8;
    }
    if (table.current) table.current.position.x = Math.sin(progress.current * 0.45) * 0.3;
  });
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <mesh castShadow position={[0, 0.26, 0]}><boxGeometry args={[4.12, 0.52, 3.55]} />
        <meshStandardMaterial color="#394b54" metalness={0.52} roughness={0.4} /></mesh>
      {[-1.84, 1.84].map((x) => <mesh key={x} castShadow position={[x, 1.65, 0]}>
        <boxGeometry args={[0.42, 2.38, 3.5]} />
        <meshStandardMaterial color={faulted ? "#69403b" : "#3c505b"} metalness={0.47} roughness={0.4} /></mesh>)}
      <mesh castShadow position={[0, 1.62, 1.57]}><boxGeometry args={[3.62, 2.35, 0.38]} />
        <meshStandardMaterial color="#344950" metalness={0.4} roughness={0.45} /></mesh>
      {!cutaway && <mesh castShadow position={[0, 2.94, 0]}><boxGeometry args={[4.15, 0.43, 3.55]} />
        <meshStandardMaterial color="#798d98" metalness={0.58} roughness={0.32} /></mesh>}
      {[-1.48, 1.48].map((x) => <mesh key={`door-${x}`} position={[x, 1.83, -1.76]}>
        <boxGeometry args={[0.15, 1.9, 0.1]} /><meshStandardMaterial color="#aebcbd" metalness={0.8} roughness={0.28} /></mesh>)}
      <mesh position={[0, 2.78, -1.76]}><boxGeometry args={[3.06, 0.15, 0.1]} />
        <meshStandardMaterial color="#aebcbd" metalness={0.8} roughness={0.28} /></mesh>
      <mesh position={[0, 1.68, 1.35]}><boxGeometry args={[3.15, 1.88, 0.05]} />
        <meshStandardMaterial color="#142328" metalness={0.1} roughness={0.7} /></mesh>
      <mesh position={[0.32, 1.8, -1.79]}>
        <boxGeometry args={[2.55, 1.84, 0.06]} />
        <meshStandardMaterial color="#1b343e" transparent opacity={0.12} metalness={0.35} roughness={0.18} />
      </mesh>
      <mesh castShadow position={[0.32, 1.78, -1.83]}>
        <boxGeometry args={[2.34, 1.62, 0.04]} />
        <meshStandardMaterial color="#9bc4bd" transparent opacity={0.1} metalness={0.2} roughness={0.2} />
      </mesh>
      <group ref={spindleHead} position={[0, 2.2, 0.15]}>
        <mesh castShadow position={[0, 0.22, 0]}><boxGeometry args={[0.72, 0.5, 0.82]} />
          <meshStandardMaterial color="#bbc7c4" metalness={0.74} roughness={0.27} /></mesh>
        <mesh castShadow position={[0, -0.23, 0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.18, 0.18, 0.58, 20]} /><meshStandardMaterial color="#e0b762" metalness={0.84} roughness={0.22} /></mesh>
        <mesh castShadow position={[0, -0.54, 0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.1, 0.1, 0.18, 16]} /><meshStandardMaterial color="#d5e1dd" metalness={0.8} roughness={0.22} /></mesh>
      </group>
      <group ref={table} position={[0, 0.92, -0.12]}>
        <mesh castShadow><boxGeometry args={[1.68, 0.28, 1.24]} />
          <meshStandardMaterial color="#79888a" metalness={0.72} roughness={0.28} /></mesh>
        <mesh castShadow position={[0, 0.28, 0]}><boxGeometry args={[0.72, 0.45, 0.58]} />
          <meshStandardMaterial color="#bd8a49" metalness={0.5} roughness={0.3} /></mesh>
        <mesh castShadow position={[0, 0.53, 0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.22, 0.22, 0.42, 18]} /><meshStandardMaterial color="#d1dcda" metalness={0.88} roughness={0.2} /></mesh>
      </group>
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

export function RobotRail({ position }: { position: [number, number] }) {
  return <group position={[position[0], 0, position[1]]}>
    <mesh position={[0, 0.11, 0]}><boxGeometry args={[20, 0.2, 0.92]} />
      <meshStandardMaterial color="#37464c" metalness={0.62} roughness={0.36} /></mesh>
    {[-0.31, 0.31].map((z) => <mesh key={z} position={[0, 0.23, z]}>
      <boxGeometry args={[20, 0.08, 0.12]} />
      <meshStandardMaterial color="#9aa9a7" metalness={0.82} roughness={0.25} /></mesh>)}
    {Array.from({ length: 21 }, (_, index) => <mesh key={index} position={[-9.6 + index * 0.96, 0.045, 0]}>
      <boxGeometry args={[0.1, 0.06, 0.74]} />
      <meshStandardMaterial color="#65757a" metalness={0.5} roughness={0.38} /></mesh>)}
  </group>;
}

function ArmLink({ from, to }: { from: THREE.Vector3; to: THREE.Vector3 }) {
  const direction = to.clone().sub(from);
  const middle = from.clone().add(to).multiplyScalar(0.5);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return <mesh castShadow position={middle} quaternion={rotation}>
    <boxGeometry args={[0.27, direction.length(), 0.29]} />
    <meshStandardMaterial color="#e4ab50" metalness={0.5} roughness={0.3} />
  </mesh>;
}

export function Robot({ asset, machine, rotation, position, selected, onSelect, elapsed, tip, showLabels = true }: {
  asset: WorkshopAsset; machine: MachineModel; rotation: number; position: [number, number]; elapsed: number;
  selected: boolean; onSelect: () => void; tip?: [number, number, number]; showLabels?: boolean;
}) {
  const reach = tip ? new THREE.Vector3(tip[0] - position[0], tip[1], tip[2] - position[1])
    : new THREE.Vector3(0, 1.35 + Math.sin(elapsed * 1.3) * 0.2, asset.id === 'R01' ? -2.5 : 2.5);
  const root = new THREE.Vector3(0, 0.68, 0);
  const elbow = root.clone().lerp(reach, 0.48);
  elbow.y += 1.4;
  return <group position={[position[0], 0, position[1]]} onClick={(event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation(); onSelect();
  }}>
    <mesh castShadow position={[0, 0.22, 0]}><boxGeometry args={[1.25, 0.35, 0.86]} />
      <meshStandardMaterial color="#4b5e63" metalness={0.7} roughness={0.3} /></mesh>
    <mesh castShadow position={[0, 0.5, 0]}><cylinderGeometry args={[0.43, 0.5, 0.45, 24]} />
      <meshStandardMaterial color="#273c40" metalness={0.7} roughness={0.3} /></mesh>
    <ArmLink from={root} to={elbow} /><ArmLink from={elbow} to={reach} />
    {[root, elbow, reach].map((joint, index) => <mesh key={index} position={joint} castShadow>
      <sphereGeometry args={[index === 2 ? 0.16 : 0.24, 16, 12]} />
      <meshStandardMaterial color="#758d8c" metalness={0.8} roughness={0.25} /></mesh>)}
    <group position={reach}>
      {[-0.2, 0.2].map((x) => <mesh key={x} castShadow position={[x, -0.13, 0]}>
        <boxGeometry args={[0.09, 0.35, 0.2]} /><meshStandardMaterial color="#c1c9c0" metalness={0.8} roughness={0.2} /></mesh>)}
    </group>
    {selected && <SelectionHalo color="#70e5ce" />}
    {showLabels && <Tag asset={asset} active={selected} onSelect={() => onSelect()} position={[1.7, 0.32, 0]} />}
  </group>;
}

export function AMR({ asset, position, heading, selected, carrying = false, onSelect, showLabels = true, elapsed = 0 }: {
  asset: WorkshopAsset; position: [number, number]; heading: number; selected: boolean;
  carrying?: boolean; onSelect: () => void; showLabels?: boolean; elapsed?: number;
}) {
  const lidar = useRef<THREE.Group>(null);
  useFrame((_, delta) => { if (lidar.current) lidar.current.rotation.y = elapsed * 1.2; });
  return <group position={[position[0], 0, position[1]]} rotation-y={-heading}
    onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
    <mesh castShadow position={[0, 0.27, 0]}><boxGeometry args={[1.62, 0.43, 1.04]} />
      <meshStandardMaterial color="#21b9a5" metalness={0.42} roughness={0.31} /></mesh>
    <mesh castShadow position={[0, 0.51, 0]}><boxGeometry args={[1.22, 0.13, 0.78]} />
      <meshStandardMaterial color="#9aab9f" metalness={0.3} roughness={0.48} /></mesh>
    {carrying ? <group position={[0.02, 0.76, 0]}>
      <mesh castShadow rotation-z={Math.PI / 2}><cylinderGeometry args={[0.16, 0.16, 0.72, 24]} />
        <meshStandardMaterial color="#dbe4df" metalness={0.9} roughness={0.18} /></mesh>
      <mesh castShadow position={[-0.22, 0, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.23, 0.23, 0.13, 24]} />
        <meshStandardMaterial color="#aebcb6" metalness={0.86} roughness={0.2} /></mesh>
      <mesh castShadow position={[0.23, 0, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.2, 0.2, 0.16, 24]} />
        <meshStandardMaterial color="#b9c6c1" metalness={0.86} roughness={0.2} /></mesh>
    </group> : asset.id === 'AMR02' ? <mesh castShadow position={[0.02, 0.72, 0.02]}><boxGeometry args={[0.7, 0.3, 0.56]} />
      <meshStandardMaterial color="#c58e4e" metalness={0.24} roughness={0.46} /></mesh> : null}
    <group ref={lidar} position={[-0.5, 0.66, 0]}>
      <mesh><cylinderGeometry args={[0.08, 0.1, 0.26, 16]} />
        <meshStandardMaterial color="#d6e4da" metalness={0.75} roughness={0.23} /></mesh>
      <mesh position={[0, 0.15, 0]}><torusGeometry args={[0.13, 0.035, 8, 20]} />
        <meshStandardMaterial color="#e2bd64" emissive="#d19e42" emissiveIntensity={0.65} /></mesh>
    </group>
    <mesh position={[0.55, 0.54, -0.1]}><boxGeometry args={[0.19, 0.14, 0.18]} />
      <meshStandardMaterial color="#e8f7dc" emissive="#8df3b3" emissiveIntensity={1.6} /></mesh>
    <mesh position={[0.61, 0.54, 0.15]}><boxGeometry args={[0.12, 0.12, 0.18]} />
      <meshStandardMaterial color="#f0b756" emissive="#d28e35" emissiveIntensity={1.1} /></mesh>
    {[[-0.48, -0.43], [-0.48, 0.43], [0.48, -0.43], [0.48, 0.43]].map(([x, z]) =>
      <mesh key={`${x}:${z}`} position={[x, 0.13, z]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.09, 0.09, 0.08, 14]} /><meshStandardMaterial color="#11191c" /></mesh>)}
    {selected && <SelectionHalo color="#70e5ce" />}
    {showLabels && <Tag asset={asset} active={selected} onSelect={onSelect} position={[0, 0.16, 1.15]} />}
  </group>;
}

export function StaticAsset({ asset, selected, onSelect, showLabels = true }: {
  asset: WorkshopAsset; selected: boolean; onSelect: () => void; showLabels?: boolean;
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
    {showLabels && <Tag asset={asset} active={selected} onSelect={onSelect} />}
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

export function ZoneSign({ position, rotationY = 0, label, color }: {
  position: [number, number]; rotationY?: number; label: string; color: string;
}) {
  return <WorldPlate name={`zone-label-${label}`} position={[position[0], 0.16, position[1]]}
    rotation={[-Math.PI / 2, 0, rotationY]} size={[4.2, 0.72]} title={label} accent={color} />;
}
