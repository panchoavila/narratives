import type { Carousel3DConfig } from './carousel-3d-config';

const radians = Math.PI / 180;
type Point = { x: number; y: number; z: number };

/** CSS applies rotateX · rotateY · rotateZ from right to left. */
function rotate(point: Point, x: number, y: number, z: number): Point {
  const cx = Math.cos(x * radians), sx = Math.sin(x * radians);
  const cy = Math.cos(y * radians), sy = Math.sin(y * radians);
  const cz = Math.cos(z * radians), sz = Math.sin(z * radians);
  const zx = point.x * cz - point.y * sz, zy = point.x * sz + point.y * cz;
  const yx = zx * cy + point.z * sy, yz = -zx * sy + point.z * cy;
  return { x: yx, y: zy * cx - yz * sx, z: zy * sx + yz * cx };
}

export interface Carousel3DPose {
  transform: string;
  center: Point;
  normal: Point;
  opacity: number;
  visible: boolean;
}

/** Gap is measured along the layout surface before scene scaling/projection. */
export function carousel3DLayout(config: Carousel3DConfig, count: number) {
  const rows = Math.min(config.rows, Math.max(1, count));
  const latitudes = Array.from({ length: rows }, (_, row) => {
    if (rows === 1) return 0;
    const fraction = config.distribution === 'gap' ? (row + 0.5) / rows : row / (rows - 1);
    return (fraction - 0.5) * config.latitude;
  });
  const columns = Array.from({ length: rows }, (_, row) =>
    Math.floor(count / rows) + (row < count % rows ? 1 : 0));
  let radius = config.radius;
  if (config.distribution === 'gap' && count > 1) {
    if (config.layout === 'sphere') {
      // Allocate fewer cards near the poles, where latitude circles shrink.
      const weights = latitudes.map(latitude => Math.max(0, Math.cos(latitude * radians)));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const quotas = weights.map(weight => total > 0.000001 ? (count - rows) * weight / total : (count - rows) / rows);
      quotas.forEach((quota, row) => { columns[row] = 1 + Math.floor(quota); });
      const remainder = count - columns.reduce((sum, value) => sum + value, 0);
      const order = quotas.map((quota, row) => ({ row, fraction: quota % 1 })).sort((a, b) => b.fraction - a.fraction);
      for (let i = 0; i < remainder; i++) columns[order[i].row]++;
    }
    radius = 0;
    for (let row = 0; row < rows; row++) {
      if (columns[row] < 2) continue;
      const segments = config.arc >= 360 ? columns[row] : columns[row] - 1;
      const latitudeScale = config.layout === 'sphere' ? Math.max(0.01, Math.cos(latitudes[row] * radians)) : 1;
      const angularStep = Math.max(0.01, config.arc * radians) / segments;
      radius = Math.max(radius, (config.itemWidth + config.gap) / (angularStep * latitudeScale * Math.max(0.01, Math.min(1, config.depth))));
    }
    if (config.layout === 'sphere' && rows > 1) {
      const latitudeStep = (latitudes[1] - latitudes[0]) * radians;
      radius = Math.max(radius, (config.itemHeight + config.gap) / Math.max(0.0001, latitudeStep * Math.min(1, config.depth)));
    }
    if (!radius) radius = config.radius;
  }
  return {
    rows, columns, latitudes, radius,
    lineStep: config.distribution === 'gap' ? config.itemWidth + config.gap : config.spacing,
    rowStep: config.distribution === 'gap' ? config.itemHeight + config.gap : config.rowGap,
  };
}

export function carousel3DGeometry(config: Carousel3DConfig, count: number, phase = config.phase,
  rotation = { x: config.rotateX, y: config.rotateY, z: config.rotateZ }): Carousel3DPose[] {
  const layout = carousel3DLayout(config, count);
  let index = 0;
  const result: Carousel3DPose[] = [];
  for (let row = 0; row < layout.rows; row++) {
    const columns = layout.columns[row];
    const latitude = layout.latitudes[row];
    const phi = latitude * radians;
    for (let column = 0; column < columns; column++, index++) {
      const fraction = columns <= 1 ? 0 : column / (config.arc >= 360 ? columns : columns - 1) - 0.5;
      const angle = fraction * config.arc + phase + row * config.stagger;
      const theta = angle * radians;
      const sphere = config.layout === 'sphere';
      const radius = layout.radius * (sphere ? Math.cos(phi) : 1);
      const lineColumn = ((column + (phase + row * config.stagger) / 360 * columns) % columns + columns) % columns;
      const position = config.layout === 'line'
        ? { x: (lineColumn - (columns - 1) / 2) * layout.lineStep, y: (row - (layout.rows - 1) / 2) * layout.rowStep, z: 0 }
        : {
          x: radius * Math.sin(theta),
          y: sphere ? layout.radius * Math.sin(phi) : (row - (layout.rows - 1) / 2) * layout.rowStep + fraction * config.pitch,
          z: radius * config.depth * Math.cos(theta),
        };
      const center = rotate(position, rotation.x, rotation.y, rotation.z);
      let alignment = '';
      let normal = rotate({ x: 0, y: 0, z: 1 }, config.itemRotateX, config.itemRotateY, config.itemRotateZ + index * config.twist);
      if (config.orientation === 'billboard') {
        alignment = `rotateZ(${-rotation.z}deg) rotateY(${-rotation.y}deg) rotateX(${-rotation.x}deg)`;
      } else {
        if (config.orientation === 'surface' && config.layout !== 'line') {
          // The ellipsoid normal accounts for a squashed depth axis.
          const yaw = Math.atan2(config.depth * Math.sin(theta), Math.cos(theta)) / radians;
          const horizontalNormal = Math.hypot(Math.cos(phi) * Math.sin(theta),
            Math.cos(phi) * Math.cos(theta) / Math.max(0.000001, config.depth));
          const tilt = sphere ? -Math.atan2(Math.sin(phi), horizontalNormal) / radians : 0;
          alignment = `rotateY(${yaw}deg) rotateX(${tilt}deg)`;
          normal = rotate(normal, tilt, 0, 0);
          normal = rotate(normal, 0, yaw, 0);
        } else if (config.orientation === 'radial') {
          alignment = `rotateY(${angle}deg) rotateX(-90deg)`;
          normal = rotate(normal, -90, 0, 0);
          normal = rotate(normal, 0, angle, 0);
        }
        normal = rotate(normal, rotation.x, rotation.y, rotation.z);
      }
      const facing = config.perspective > 0
        ? normal.x * -center.x + normal.y * -center.y + normal.z * (config.perspective - center.z)
        : normal.z;
      result.push({
        center, normal,
        transform: `translate3d(${position.x}px,${position.y}px,${position.z}px) ${alignment} rotateX(${config.itemRotateX}deg) rotateY(${config.itemRotateY}deg) rotateZ(${config.itemRotateZ + index * config.twist}deg) translate(-50%,-50%)`,
        opacity: 1 - config.depthFade * Math.max(0, Math.min(1, 0.5 - center.z / (2 * layout.radius * Math.max(1, config.depth)))),
        visible: config.backfaces || facing > 0.001,
      });
    }
  }
  return result;
}

/** Fit the whole tilted volume, allowing intentional camera offsets to crop it. */
export function carousel3DFit(config: Carousel3DConfig, count: number, width: number, height: number): number {
  if (!config.fit || !width || !height) return config.zoom;
  const poses = carousel3DGeometry(config, count);
  const padding = Math.hypot(config.itemWidth, config.itemHeight) / 2;
  let scale = Math.min(1, width * 0.46 / padding, height * 0.46 / padding);
  for (const { center } of poses) {
    const depth = config.perspective > 0 ? (center.z + padding) / config.perspective : 0;
    scale = Math.min(scale,
      width * 0.46 / Math.max(padding, Math.abs(center.x) + padding + width * 0.46 * depth),
      height * 0.46 / Math.max(padding, Math.abs(center.y) + padding + height * 0.46 * depth));
  }
  return scale * config.zoom;
}
