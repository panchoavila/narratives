import { type DisplacementNavigationResult } from './displacement-navigation';
import { type RippleConfig } from './ripple-config';
export declare function runRippleNavigation(options: {
    config: RippleConfig;
    navigate: () => Promise<void>;
    signal?: AbortSignal;
    origin?: {
        x: number;
        y: number;
    };
}): Promise<DisplacementNavigationResult>;
