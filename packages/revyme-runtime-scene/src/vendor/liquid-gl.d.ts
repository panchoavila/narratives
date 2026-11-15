import type { LiquidGlassConfig } from '../liquid-glass-config';

export interface LiquidLens {
  options: Omit<LiquidGlassConfig, 'tint'> & { tint: number[] | null };
  renderer: {
    canvas: HTMLCanvasElement;
    backend: { gl?: WebGLRenderingContext; device?: { lost: Promise<unknown> } } | null;
    _backendReady: Promise<void>;
    _backendFailed: boolean;
    captureSnapshot(): Promise<void>;
    render(): void;
  } | null;
  tiltX: number;
  tiltY: number;
  destroy(): void;
  setTint(value: string | null): void;
  setTilt(value: boolean): void;
  setShadow(value: boolean): void;
}

export interface LiquidEngine {
  (options: Partial<LiquidGlassConfig> & {
    target: string; snapshot?: string; engine?: 'auto' | 'webgl2' | 'webgpu';
    content?: false; preserveMotion?: boolean; anchor?: HTMLElement; liveBackdrop?: HTMLCanvasElement;
    on?: { init?: (lens: LiquidLens) => void };
  }): LiquidLens | LiquidLens[] | undefined;
  registerDynamic(elements: Element[]): void;
  refresh(): void;
}

export default function createLiquidGlassEngine(options?: { measureElement?: (element: Element) => DOMRect }): LiquidEngine | undefined;
