import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  createSpringState,
  DEFAULT_SPRING_PARAMS,
  pinBody,
  releaseBody,
  setSpringTargets,
  snapToTargets,
  springPositions,
  stepSpring,
  type Point,
  type SpringParams,
} from './springLayout';

const FRAME_MS = 1000 / 60;
// Largest single simulation step (in 60 fps frames) and most sub-steps per animation frame.
const MAX_SUBSTEP = 1.5;
const MAX_SUBSTEPS = 40;

export interface UseSpringLayoutOptions {
  /** Called with every body's position after each simulation frame. */
  onFrame: (positions: Map<string, Point>) => void;
  /** When true, bodies jump straight to their targets and neighbours do not follow drags. */
  reducedMotion?: boolean;
  params?: SpringParams;
}

export interface SpringLayoutControls {
  /** Set a new target layout; returns the positions bodies start the transition from. */
  retarget: (targets: Map<string, Point>, links: Array<[string, string]>) => Map<string, Point>;
  /** Hold a body at a point (call on every drag move). */
  pin: (id: string, point: Point) => void;
  /** Let a held body go; it stays where it was dropped. */
  release: (id: string) => void;
}

/**
 * Runs the spring simulation on requestAnimationFrame while anything is moving and
 * stops once it settles, so an idle graph costs nothing. Library-agnostic: the caller
 * maps positions onto whatever renders the graph.
 */
export function useSpringLayout({
  onFrame,
  reducedMotion = false,
  params = DEFAULT_SPRING_PARAMS,
}: UseSpringLayoutOptions): SpringLayoutControls {
  const stateRef = useRef(createSpringState());
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);
  const paramsRef = useRef(params);
  const reducedMotionRef = useRef(reducedMotion);

  useEffect(() => {
    onFrameRef.current = onFrame;
    paramsRef.current = params;
    reducedMotionRef.current = reducedMotion;
  }, [onFrame, params, reducedMotion]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    lastTimeRef.current = null;
  }, []);

  const tick = useCallback((time: number) => {
    const last = lastTimeRef.current;
    const dt = last === null ? 1 : (time - last) / FRAME_MS;
    lastTimeRef.current = time;

    // When frames arrive late (slow machine, throttled tab), catch up with several small
    // sub-steps rather than one big one, so motion takes about the same wall-clock time
    // and each step stays numerically stable. Positions are published once per frame.
    const substeps = Math.min(Math.max(Math.ceil(dt / MAX_SUBSTEP), 1), MAX_SUBSTEPS);
    const stepDt = Math.min(dt, MAX_SUBSTEP * MAX_SUBSTEPS) / substeps;
    let moving = false;
    for (let i = 0; i < substeps; i += 1) {
      moving = stepSpring(stateRef.current, paramsRef.current, stepDt);
      if (!moving) break;
    }
    onFrameRef.current(springPositions(stateRef.current));

    if (moving) {
      frameRef.current = requestAnimationFrame(tick);
    } else {
      frameRef.current = null;
      lastTimeRef.current = null;
    }
  }, []);

  const wake = useCallback(() => {
    if (reducedMotionRef.current) {
      snapToTargets(stateRef.current);
      onFrameRef.current(springPositions(stateRef.current));
      return;
    }
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const retarget = useCallback((targets: Map<string, Point>, links: Array<[string, string]>) => {
    const state = stateRef.current;
    let bloomFrom: Point | undefined;
    if (state.bodies.size === 0 && targets.size > 1 && !reducedMotionRef.current) {
      let sx = 0;
      let sy = 0;
      targets.forEach((point) => {
        sx += point.x;
        sy += point.y;
      });
      bloomFrom = { x: sx / targets.size, y: sy / targets.size };
    }

    setSpringTargets(state, targets, links, { bloomFrom });
    if (reducedMotionRef.current) snapToTargets(state);
    const start = springPositions(state);
    wake();
    return start;
  }, [wake]);

  const pin = useCallback((id: string, point: Point) => {
    pinBody(stateRef.current, id, point);
    wake();
  }, [wake]);

  const release = useCallback((id: string) => {
    releaseBody(stateRef.current, id);
    wake();
  }, [wake]);

  // Turning on reduced motion mid-animation stops it and jumps straight to the targets,
  // rather than letting the running animation play out.
  useEffect(() => {
    if (!reducedMotion) return;
    stop();
    snapToTargets(stateRef.current);
    onFrameRef.current(springPositions(stateRef.current));
  }, [reducedMotion, stop]);

  useEffect(() => stop, [stop]);

  // Stable identity: callers list these controls in effect dependencies.
  return useMemo(() => ({ retarget, pin, release }), [retarget, pin, release]);
}
