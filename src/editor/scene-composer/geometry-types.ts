export type Layer={id:string;parentId:string|null;tag:string;depth:number;scene:0|1|null;rect:{x:number;y:number;width:number;height:number}};
export type Snapshot={revision:number;renderSeq:number;width:number;height:number;layers:Layer[];receivedAt:number};

