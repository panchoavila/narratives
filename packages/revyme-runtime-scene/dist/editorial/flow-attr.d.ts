import type { ObjectHeight, ObjectRole, Placement, RoleRule } from './types';
export declare const FLOW_ATTRIBUTE = "data-flow";
export declare const FLOW_OBJECT_ROLES: readonly ObjectRole[];
export interface FlowObjectSettings {
    v: 1;
    role: ObjectRole;
    /** Body paragraphs before the object. 0 places it among the objects that open the piece. */
    after: number;
    /** Where the object goes, instead of its role's placement. */
    place?: Placement;
    /** How tall it is, instead of its role's rule. */
    height?: ObjectHeight;
    /** Most of the frame height it may take, as a fraction. */
    maxHeight?: number;
    /** Width / height of the element. Without it, the element's own size or the rule decides. */
    aspect?: number;
}
export declare const DEFAULT_FLOW_OBJECT: FlowObjectSettings;
export interface FlowAttributeProblem {
    /** Where in the settings, e.g. `place.span`. Empty for the attribute as a whole. */
    path: string;
    message: string;
}
/** The settings in `raw` (the attribute's string, or already-parsed JSON), and every problem found.
 *  Never throws; what cannot be used falls back to the defaults. */
export declare function readFlowAttribute(raw: unknown): {
    settings: FlowObjectSettings;
    problems: FlowAttributeProblem[];
};
/** The attribute's value for `settings`: JSON with a stable key order and only what is set. */
export declare function writeFlowAttribute(settings: FlowObjectSettings): string;
/** The part of a role rule the settings replace. */
export declare function flowRuleOverride(settings: FlowObjectSettings): Partial<RoleRule>;
