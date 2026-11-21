import { ToolInput, ToolSelect } from '../../../controls';
import { UnifiedControlProvider, ControlRow, useControlContext } from '../../../controls/unified';
import type { AtomProps } from '../../../controls/unified/types';

const typeOptions = [
  {value:'none',label:'None'}, {value:'x mandatory',label:'Horizontal · mandatory'}, {value:'x proximity',label:'Horizontal · proximity'},
  {value:'y mandatory',label:'Vertical · mandatory'}, {value:'y proximity',label:'Vertical · proximity'},
  {value:'both mandatory',label:'Both · mandatory'}, {value:'both proximity',label:'Both · proximity'},
];
const alignOptions = [{value:'none',label:'None'}, {value:'start',label:'Start'}, {value:'center',label:'Center'}, {value:'end',label:'End'}];
/** CSS omits the default proximity keyword in computed styles. Never rewrite source on read. */
export function scrollSnapDisplayValue(value: string): string {
  return /^(x|y|both)$/.test(value) ? `${value} proximity` : value;
}
function Select({options, fallback, normalize = (value: string) => value}:{options:{value:string;label:string}[];fallback:string;normalize?:(value:string)=>string}) {
  const {value,onChange}=useControlContext();
  const selected=normalize(value || fallback);
  // A valid CSS value the control does not model remains visible and untouched.
  const available=options.some(option=>option.value===selected) ? options : [...options,{value:selected,label:selected}];
  return <ToolSelect value={selected} onChange={onChange} options={available} />;
}
function Padding() { const {value,onChange}=useControlContext(); return <ToolInput text value={value || '0px'} onChange={onChange} />; }
export function ScrollSnapTypeControl({mode='direct',...mp}:AtomProps) { return <UnifiedControlProvider property="scrollSnapType" defaultValue="none" mode={mode} {...mp}><ControlRow label="Scroll snap"><Select options={typeOptions} fallback="none" normalize={scrollSnapDisplayValue} /></ControlRow></UnifiedControlProvider>; }
export function ScrollSnapAlignControl({mode='direct',...mp}:AtomProps) { return <UnifiedControlProvider property="scrollSnapAlign" defaultValue="none" mode={mode} {...mp}><ControlRow label="Snap align"><Select options={alignOptions} fallback="none" /></ControlRow></UnifiedControlProvider>; }
export function ScrollPaddingLeftControl({mode='direct',...mp}:AtomProps) { return <UnifiedControlProvider property="scrollPaddingLeft" defaultValue="0px" mode={mode} {...mp}><ControlRow label="Scroll padding left"><Padding /></ControlRow></UnifiedControlProvider>; }
