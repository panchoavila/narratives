/** Serializable settings shared by the editor adapter and the published component. */
export declare const DEFAULT_NOVA_WARP: {
    bgColor: string;
    starColor: string;
    starTint: string;
    cloudColor: string;
    cloudTint: string;
    starCount: number;
    starSize: number;
    trailLength: number;
    cloudOpacity: number;
    cloudScale: number;
    cloudRotation: number;
    idleSpeed: number;
    boost: number;
    response: number;
    centerX: number;
    centerY: number;
    parallax: number;
    triggerId: string;
    followTarget: boolean;
    paused: boolean;
};
export type NovaWarpConfig = typeof DEFAULT_NOVA_WARP;
export declare function normalizeNovaWarp(input: Partial<NovaWarpConfig>): NovaWarpConfig;
