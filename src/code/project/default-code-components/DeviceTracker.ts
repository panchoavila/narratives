const controls={fieldName:{type:'text',label:'Field prefix',default:'deviceData'},trackingHosts:{type:'text',label:'Collection hosts',default:''},showData:{type:'toggle',label:'Show details',default:false}};
export const DEVICE_TRACKER_COMPONENT=`'use client';
/** @label "Device Tracker" */
/** @defaultWidth 24 */
/** @defaultHeight 24 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls,null,2)} */
import {RevymeDeviceTracker,withResponsiveProps,useStaticCanvas} from '@revyme/runtime';
type DeviceTrackerProps=import('@revyme/runtime').DeviceTrackerProps;
function DeviceTracker(props:DeviceTrackerProps){const isStatic=useStaticCanvas();return <RevymeDeviceTracker {...props} static={isStatic}/>;}
export default withResponsiveProps(DeviceTracker);
`;
