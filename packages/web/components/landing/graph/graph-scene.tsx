"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei/core/OrbitControls"
import { Html } from "@react-three/drei/web/Html"
import type { OrbitControls as Controls } from "three-stdlib"
import { useEffect, useMemo, useRef, useState } from "react"
import { Vector3 } from "three"
import { graphNodes, mobileNodeIds } from "./graph-data"
import { GraphNodeObject, GraphWires, makeHalo } from "./graph-objects"
import { graphPalette } from "./graph-palette"
import { useGraphFocus, setFocused } from "./use-graph-focus"

export interface GraphSceneProps {
  readonly mobile: boolean
  readonly active: boolean
  readonly rotation: number
  readonly focusRequest: number
  readonly onReady: () => void
  readonly onFailure: () => void
}

function Scene({ mobile, active, rotation, focusRequest, onReady }: GraphSceneProps) {
  const { camera, invalidate } = useThree()
  const controls = useRef<Controls>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const focus = useGraphFocus()
  const { focusedId, setFocused } = focus
  const lastInput = useRef(0)
  const interacting = useRef(false)
  const ready = useRef(false)
  const texture = useMemo(makeHalo, [])
  const nodes = useMemo(
    () => graphNodes.filter((node) => !mobile || mobileNodeIds.some((id) => id === node.id)),
    [mobile],
  )
  const transition = useRef<{
    start: number
    from: Vector3
    targetFrom: Vector3
    to: Vector3
    target: Vector3
  } | null>(null)
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => {
    if (active) return
    const timer = window.setInterval(invalidate, 1000)
    return () => window.clearInterval(timer)
  }, [active, invalidate])
  useEffect(() => {
    const node = nodes.find((entry) => entry.id === focusedId)
    const target = node ? new Vector3(...node.position) : new Vector3(0, 0, -2)
    transition.current = {
      start: performance.now(),
      from: camera.position.clone(),
      targetFrom: controls.current?.target.clone() ?? new Vector3(0, 0, -2),
      target,
      to: node ? target.clone().add(new Vector3(0, 0, 7)) : new Vector3(0, 1, 12),
    }
    invalidate()
  }, [focusedId, focus, camera, nodes, invalidate])
  useEffect(() => {
    if (!focusRequest) return
    const nearest = nodes.reduce<{ id: string; distance: number } | null>((best, node) => {
      const distance = camera.position.distanceToSquared(new Vector3(...node.position))
      return !best || distance < best.distance ? { id: node.id, distance } : best
    }, null)
    if (nearest) setFocused(nearest.id)
  }, [focusRequest, camera, nodes, setFocused])
  useEffect(() => {
    if (!rotation || !controls.current) return
    const offset = camera.position.clone().sub(controls.current.target)
    offset.applyAxisAngle(new Vector3(0, 1, 0), rotation > 0 ? Math.PI / 12 : -Math.PI / 12)
    camera.position.copy(controls.current.target).add(offset)
    lastInput.current = performance.now()
    invalidate()
  }, [rotation, camera, invalidate])
  useFrame((_, delta) => {
    if (!ready.current) {
      ready.current = true
      requestAnimationFrame(onReady)
    }
    const orbit = controls.current
    if (!orbit) return
    const now = performance.now()
    const tween = transition.current
    if (tween) {
      const t = Math.min(1, (now - tween.start) / 600)
      const eased = 1 - Math.pow(1 - t, 4)
      camera.position.lerpVectors(tween.from, tween.to, eased)
      orbit.target.lerpVectors(tween.targetFrom, tween.target, eased)
      if (t === 1) transition.current = null
    } else if (!interacting.current && now - lastInput.current >= 4000) {
      const offset = camera.position.clone().sub(orbit.target)
      offset.applyAxisAngle(new Vector3(0, 1, 0), Math.min(delta, 1) * 0.15)
      camera.position.copy(orbit.target).add(offset)
    }
    orbit.update()
  })
  const label = nodes.find((node) => node.id === (hovered ?? focusedId))
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight intensity={1.2} color={graphPalette.accentHot} position={[3, 5, 6]} />
      <GraphWires nodes={nodes} mobile={mobile} />
      {nodes.map((node) => (
        <GraphNodeObject
          key={node.id}
          node={node}
          texture={texture}
          hovered={hovered === node.id}
          onHover={setHovered}
          onFocus={setFocused}
        />
      ))}
      {label && (
        <Html
          position={label.position}
          center
          style={{ pointerEvents: "none", transform: "translateY(-32px)" }}
        >
          <span className="rounded-[2px] border border-[var(--line)] bg-[var(--ink-2)] px-3 py-1 font-mono text-xs whitespace-nowrap text-[var(--text-hi)]">
            {label.label}
          </span>
        </Html>
      )}
      <OrbitControls
        ref={controls}
        target={[0, 0, -2]}
        enableZoom={false}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={(2 * Math.PI) / 3}
        onStart={() => {
          interacting.current = true
          transition.current = null
          lastInput.current = performance.now()
        }}
        onEnd={() => {
          interacting.current = false
          lastInput.current = performance.now()
        }}
      />
    </>
  )
}

export default function GraphScene(props: GraphSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 1, 12], fov: 45 }}
      dpr={[1, props.mobile ? 1.25 : 1.75]}
      gl={{ antialias: !props.mobile, powerPreference: "high-performance", alpha: true }}
      frameloop={props.active ? "always" : "demand"}
      onPointerMissed={() => setFocused(null)}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", props.onFailure, { once: true })
      }}
    >
      <Scene {...props} />
    </Canvas>
  )
}
