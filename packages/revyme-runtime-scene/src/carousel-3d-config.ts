/** All distances are CSS pixels in the carousel's local scene. Angles are degrees. */
export interface Carousel3DConfig {
  layout: 'cylinder' | 'sphere' | 'line';
  distribution: 'fill' | 'gap';
  gap: number;
  radius: number;
  depth: number;
  arc: number;
  phase: number;
  rows: number;
  rowGap: number;
  stagger: number;
  latitude: number;
  pitch: number;
  spacing: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  perspective: number;
  zoom: number;
  fit: boolean;
  itemWidth: number;
  itemHeight: number;
  orientation: 'surface' | 'billboard' | 'radial' | 'fixed';
  itemRotateX: number;
  itemRotateY: number;
  itemRotateZ: number;
  twist: number;
  backfaces: boolean;
  depthFade: number;
  dragMode: 'spin' | 'orbit' | 'none';
  autoplay: boolean;
  speed: number;
  pauseOnHover: boolean;
  navigation: boolean;
}

export const DEFAULT_CAROUSEL_3D: Carousel3DConfig = {
  layout: 'cylinder', distribution: 'fill', gap: 24, radius: 260, depth: 1, arc: 360, phase: 0,
  rows: 1, rowGap: 180, stagger: 0, latitude: 140, pitch: 0, spacing: 34,
  rotateX: -16, rotateY: 0, rotateZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0,
  perspective: 1200, zoom: 1, fit: true, itemWidth: 150, itemHeight: 190,
  orientation: 'surface', itemRotateX: 0, itemRotateY: 0, itemRotateZ: 0,
  twist: 0, backfaces: true, depthFade: 0, dragMode: 'spin',
  autoplay: false, speed: 12, pauseOnHover: true, navigation: true,
};

const bounds = {
  gap: [0, 2000],
  radius: [1, 5000], depth: [0, 4], arc: [0, 360], phase: [-3600, 3600],
  rows: [1, 30], rowGap: [0, 2000], stagger: [-360, 360], latitude: [0, 180],
  pitch: [-3000, 3000], spacing: [0, 1000], rotateX: [-360, 360], rotateY: [-360, 360],
  rotateZ: [-360, 360], offsetX: [-5000, 5000], offsetY: [-5000, 5000],
  offsetZ: [-5000, 5000], perspective: [0, 10000], zoom: [0.05, 5],
  itemWidth: [1, 2000], itemHeight: [1, 2000], itemRotateX: [-360, 360],
  itemRotateY: [-360, 360], itemRotateZ: [-360, 360], twist: [-180, 180],
  depthFade: [0, 1], speed: [-180, 180],
} as const;

export function normalizeCarousel3D(input: Partial<Carousel3DConfig>): Carousel3DConfig {
  const config = { ...DEFAULT_CAROUSEL_3D };
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      config[key] = Math.min(bounds[key][1], Math.max(bounds[key][0], value));
    }
  }
  config.rows = Math.round(config.rows);
  for (const key of ['fit', 'backfaces', 'autoplay', 'pauseOnHover', 'navigation'] as const) {
    if (typeof input[key] === 'boolean') config[key] = input[key];
  }
  if (input.layout === 'sphere' || input.layout === 'line') config.layout = input.layout;
  if (input.distribution === 'gap') config.distribution = 'gap';
  if (config.distribution === 'gap') {
    // A collapsed path cannot provide positive spacing between distinct items.
    config.arc = Math.max(1, config.arc);
    config.depth = Math.max(0.01, config.depth);
    config.latitude = Math.max(1, config.latitude);
  }
  if (input.orientation === 'billboard' || input.orientation === 'radial' || input.orientation === 'fixed') config.orientation = input.orientation;
  if (input.dragMode === 'orbit' || input.dragMode === 'none') config.dragMode = input.dragMode;
  return config;
}

/** Reference arrangements share the same geometry and renderer. */
export const CAROUSEL_3D_PRESETS: Record<string, Partial<Carousel3DConfig>> = {
  recap: { rotateX: 90, orientation: 'billboard', perspective: 0, radius: 230, itemWidth: 126, itemHeight: 126 },
  arena: { rotateX: 90, orientation: 'radial', perspective: 0, radius: 260, itemWidth: 27, itemHeight: 44 },
  archive: { layout: 'line', spacing: 18, itemWidth: 200, itemHeight: 280, itemRotateY: 68, rotateX: -18, rotateY: 0, rotateZ: -26, perspective: 0 },
  orbit: { rotateX: -35, itemWidth: 120, itemHeight: 150, radius: 260, depthFade: 0.55 },
  globe: { layout: 'sphere', rows: 7, radius: 280, itemWidth: 45, itemHeight: 60, rotateX: -12, stagger: 16, backfaces: false, perspective: 1600 },
  twin: { rotateX: 90, orientation: 'radial', perspective: 0, radius: 260, itemWidth: 38, itemHeight: 52, offsetX: -230 },
  cylinder: { rows: 2, radius: 330, rowGap: 165, itemWidth: 138, itemHeight: 150, rotateX: -12, depthFade: 0.8, perspective: 1500 },
  typography: { radius: 310, itemWidth: 180, itemHeight: 130, rotateX: -10, perspective: 1300 },
  fan: { radius: 200, itemWidth: 180, itemHeight: 130, itemRotateY: 90, rotateX: -35, rotateZ: -12, perspective: 1400 },
  arch: { rotateX: 90, orientation: 'radial', perspective: 0, radius: 320, arc: 190, itemWidth: 85, itemHeight: 85, offsetY: 200 },
  ribbon: { radius: 600, arc: 105, itemWidth: 200, itemHeight: 250, rotateX: 8, offsetZ: -500, perspective: 1500 },
};
