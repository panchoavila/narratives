import { type DisplacementNavigationResult } from './displacement-navigation';
import { type GlitchConfig } from './glitch-config';
/** A single Glitch burst spanning a route change. */
export declare function runGlitchNavigation(options: {
    config: GlitchConfig;
    navigate: () => Promise<void>;
    signal?: AbortSignal;
}): Promise<DisplacementNavigationResult>;
