import type { FlowDocument, FlowEnvironment, FlowLayout, FlowSpec } from './types';
/** Lays a document into pages for the spec and environment. Never drops text: an object that cannot
 *  be placed is carried to the next page, and a page that makes no progress is redone unbounded. */
export declare function layoutFlow(doc: FlowDocument, rawSpec: FlowSpec, rawEnv: FlowEnvironment): FlowLayout;
