/** Analyse a playback stream without rerouting or muting the original media. */
export declare function observeGlassAudio(doc: Document, sourceId: string): {
    readonly state: "active" | "waiting" | "unavailable";
    readonly playing: boolean;
    read(): number;
    destroy(): void;
};
