import { useEffect, useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  type MeshStandardMaterial,
  type SpriteMaterial,
} from "three"
import type { GraphNode } from "./graph-data"
import { graphEdges } from "./graph-data"
import { graphPalette as palette } from "./graph-palette"

export function makeHalo() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Graph halo requires Canvas2D")
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, palette.halo)
  gradient.addColorStop(1, palette.transparent)
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return new CanvasTexture(canvas)
}

export function GraphNodeObject({
  node,
  texture,
  hovered,
  onHover,
  onFocus,
}: {
  readonly node: GraphNode
  readonly texture: CanvasTexture
  readonly hovered: boolean
  readonly onHover: (id: string | null) => void
  readonly onFocus: (id: string) => void
}) {
  const material = useRef<MeshStandardMaterial>(null)
  const halo = useRef<SpriteMaterial>(null)
  useFrame(({ clock }) => {
    const phase = clock.elapsedTime % 12
    const lit = phase >= (node.wave - 1) * 3 && phase < 10
    const strength = phase >= 10 ? (12 - phase) / 2 : lit ? 1 : 0
    if (material.current) {
      material.current.emissiveIntensity = 0.2 + strength * 1.4
      material.current.emissive.set(
        phase >= 9 && phase < 10 ? palette.accentHot : palette.accentDim,
      )
    }
    if (halo.current) halo.current.opacity = hovered ? 1 : 0.32 + strength * 0.48
  })
  return (
    <group position={node.position}>
      <mesh
        onPointerOver={(event) => {
          event.stopPropagation()
          onHover(node.id)
        }}
        onPointerOut={() => onHover(null)}
        onClick={(event) => {
          event.stopPropagation()
          onFocus(node.id)
        }}
      >
        <icosahedronGeometry args={[node.wave === 1 ? 0.38 : 0.24, 1]} />
        <meshStandardMaterial
          ref={material}
          color={palette.ink3}
          emissive={palette.accentDim}
          emissiveIntensity={0.2}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>
      <sprite scale={hovered ? 2.4 : 1.8} raycast={() => {}}>
        <spriteMaterial
          ref={halo}
          map={texture}
          blending={AdditiveBlending}
          depthWrite={false}
          transparent
        />
      </sprite>
    </group>
  )
}

export function GraphWires({
  nodes,
  mobile,
}: {
  readonly nodes: readonly GraphNode[]
  readonly mobile: boolean
}) {
  const edges = useMemo(
    () =>
      graphEdges.flatMap((edge) => {
        const source = nodes.find((node) => node.id === edge.source)
        const target = nodes.find((node) => node.id === edge.target)
        return source && target ? [{ source, target }] : []
      }),
    [nodes],
  )
  const resources = useMemo(() => {
    const lines = new BufferGeometry()
    lines.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array(
          edges.flatMap(({ source, target }) => [...source.position, ...target.position]),
        ),
        3,
      ),
    )
    const count = Math.min(mobile ? 24 : 48, edges.length * 2)
    const progress = new Float32Array(count)
    const positions = new Float32Array(count * 3)
    const points = new BufferGeometry()
    const attribute = new BufferAttribute(positions, 3)
    points.setAttribute("position", attribute)
    return { lines, points, positions, progress, count, attribute }
  }, [edges, mobile])
  useEffect(
    () => () => {
      resources.lines.dispose()
      resources.points.dispose()
    },
    [resources],
  )
  useFrame(({ clock }) => {
    const phase = clock.elapsedTime % 12
    for (let i = 0; i < resources.count; i++) {
      const edge = edges[i % edges.length]
      if (!edge) continue
      const start = edge.source.wave === 1 ? 1 : 4
      const t = (phase - start) / 2 - Math.floor(i / edges.length) * 0.25
      resources.progress[i] = t
      for (const axis of [0, 1, 2] as const) {
        resources.positions[i * 3 + axis] =
          t >= 0 && t <= 1
            ? edge.source.position[axis] +
              (edge.target.position[axis] - edge.source.position[axis]) * t
            : 10000
      }
    }
    resources.attribute.needsUpdate = true
  })
  return (
    <>
      <lineSegments geometry={resources.lines}>
        <lineBasicMaterial color={palette.accentDim} transparent opacity={0.35} />
      </lineSegments>
      <points geometry={resources.points} frustumCulled={false}>
        <pointsMaterial
          color={palette.accentHot}
          size={6}
          sizeAttenuation={false}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </>
  )
}
