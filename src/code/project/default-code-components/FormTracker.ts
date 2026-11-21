const text=(label:string,value='')=>({type:'text',label,default:value});
const controls={
 measurementId:text('Google Analytics ID'), googleAdsId:text('Google Ads account ID'), googleAdsLabel:text('Google Ads conversion label'),
 enableGoogleAds:{type:'toggle',label:'Enable Google Ads',default:false},facebookPixelId:text('Facebook Pixel ID'),
 eventType:{type:'select',label:'Event',default:'generate_lead',options:['generate_lead','sign_up'].map(value=>({value,label:value}))},
 triggerMode:{type:'select',label:'Trigger',default:'submit',options:['submit','success'].map(value=>({value,label:value}))},
 enableValueTracking:{type:'toggle',label:'Track value',default:false},valueSourceField:text('Value field'),currency:text('Currency','USD'),leadSource:text('Lead source'),signUpMethod:text('Signup method'),trackingHosts:text('Tracking hosts'),consentMode:{type:'toggle',label:'Require consent',default:true},
};
export const FORM_TRACKER_COMPONENT=`'use client';
/** @label "Form Tracker" */
/** @defaultWidth 24 */
/** @defaultHeight 24 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls,null,2)} */
import {RevymeFormTracker,withResponsiveProps,useStaticCanvas} from '@revyme/runtime';
type FormTrackerProps = import('@revyme/runtime').FormTrackerProps;
function FormTracker(props:FormTrackerProps){const isStatic=useStaticCanvas();return <RevymeFormTracker {...props} static={isStatic}/>;}
export default withResponsiveProps(FormTracker);
`;
