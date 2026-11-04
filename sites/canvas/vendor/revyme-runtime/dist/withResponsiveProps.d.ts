import { type ComponentType } from 'react';
export default function withResponsiveProps<P extends Record<string, any>>(Component: ComponentType<P>): ComponentType<P & {
    'data-responsive'?: string;
    __canvasViewportWidth?: number;
}>;
