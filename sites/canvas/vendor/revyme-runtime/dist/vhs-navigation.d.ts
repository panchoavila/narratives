import { type VhsConfig } from './vhs-config';
import type { DisplacementNavigationResult } from './displacement-navigation';
export declare function runVhsNavigation(options: {
    config: VhsConfig;
    navigate: () => Promise<void>;
    signal?: AbortSignal;
    surface?: HTMLElement | null;
}): Promise<DisplacementNavigationResult>;
