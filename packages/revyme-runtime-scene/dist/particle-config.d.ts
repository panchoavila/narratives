export interface ParticleConfig {
    version: 1;
    count: number;
    size: number;
    sizeVariance: number;
    radius: number;
    strength: number;
    swirl: number;
    spring: number;
    drift: number;
}
export declare const DEFAULT_PARTICLE: ParticleConfig;
export declare function normalizeParticle(input: unknown): ParticleConfig | null;
