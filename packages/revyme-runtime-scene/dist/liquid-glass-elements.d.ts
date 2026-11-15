/** One observer/engine per document, shared by the preview and generated client entry. */
export declare function attachLiquidGlassElements(doc: Document, options?: {
    editing?: boolean;
}): () => void;
