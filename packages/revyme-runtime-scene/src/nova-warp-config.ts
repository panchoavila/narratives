/** Serializable settings shared by the editor adapter and the published component. */
export const DEFAULT_NOVA_WARP = {
  bgColor: '#070e28', starColor: '#69aaff', starTint: '#ffd0ed',
  cloudColor: '#334bde', cloudTint: '#a924dc',
  starCount: 1500, starSize: 1, trailLength: 1, cloudOpacity: 0.7,
  cloudScale: 1, cloudRotation: 8, idleSpeed: 0.5, boost: 1.5, response: 0.6,
  centerX: 50, centerY: 50, parallax: 0.6, triggerId: '', followTarget: true, paused: false,
};
export type NovaWarpConfig = typeof DEFAULT_NOVA_WARP;

export function normalizeNovaWarp(input: Partial<NovaWarpConfig>): NovaWarpConfig {
  const config = { ...DEFAULT_NOVA_WARP };
  const ranges = {
    starCount: [0, 5000], starSize: [0.2, 3], trailLength: [0, 3], cloudOpacity: [0, 2],
    cloudScale: [0.2, 4], cloudRotation: [-45, 45], idleSpeed: [0, 5], boost: [0, 3],
    response: [0.1, 3], centerX: [0, 100], centerY: [0, 100], parallax: [0, 3],
  };
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      config[key] = Math.min(ranges[key][1], Math.max(ranges[key][0], value));
    }
  }
  config.starCount = Math.round(config.starCount);
  for (const key of ['bgColor', 'starColor', 'starTint', 'cloudColor', 'cloudTint'] as const) {
    // Preserve editor color tokens and alpha formats; resolve them in the owning document.
    if (typeof input[key] === 'string' && input[key]!.trim() && input[key]!.length <= 256) config[key] = input[key]!.trim();
  }
  config.triggerId = typeof input.triggerId === 'string' ? input.triggerId.trim() : '';
  config.followTarget = typeof input.followTarget === 'boolean' ? input.followTarget : config.followTarget;
  config.paused = input.paused === true;
  return config;
}
