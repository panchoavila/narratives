import type { BodyGrid, FlowMode, FlowSpec, Measurer, PageGeometry, Size } from './types';
export declare function resolveBodyGrid(spec: FlowSpec, viewport: Size, measurer: Measurer): BodyGrid;
export declare function pageGeometry(index: number, grid: BodyGrid, viewport: Size, mode: FlowMode): PageGeometry;
