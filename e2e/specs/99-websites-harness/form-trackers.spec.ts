import {test,expect,project} from '../../fixtures/test';
import {FORM_TRACKER_COMPONENT} from '../../../src/code/project/default-code-components/FormTracker';
import {DEVICE_TRACKER_COMPONENT} from '../../../src/code/project/default-code-components/DeviceTracker';

test('form tracking settings persist and test transports receive only simulated events',async({page,context,editor})=>{
 const requests:string[]=[];
 await context.route('https://api.ipify.org/**',route=>{requests.push('ip');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ip:'203.0.113.9'})});});
 await context.route('https://www.googletagmanager.com/**',route=>{requests.push('google');return route.fulfill({status:200,contentType:'application/javascript',body:'// simulated provider'});});
 await context.route('https://connect.facebook.net/**',route=>{requests.push('facebook');return route.fulfill({status:200,contentType:'application/javascript',body:'// simulated provider'});});
 await page.addInitScript(()=>{try{localStorage.setItem('revyme-cookie-consent','accepted');}catch{/* initial empty document */}});
 const source=project().page(`<main data-id="root" style={{width:'100%',height:'400px'}}>
 <form data-id="form" onSubmit={(event)=>{event.preventDefault();event.currentTarget.dispatchEvent(new CustomEvent('revyme:form-result',{detail:{ok:true}}));}} style={{position:'relative',width:'300px',display:'flex',flexDirection:'column'}}>
  <FormTracker data-id="tracker" measurementId="G-1234567890" facebookPixelId="123456789012345" eventType="generate_lead" triggerMode="submit" consentMode={true} trackingHosts="localhost" style={{position:'absolute',left:'0px',top:'0px',width:'24px',height:'24px'}} />
  <DeviceTracker data-id="device" fieldName="deviceData" trackingHosts="localhost" style={{position:'absolute',left:'0px',top:'0px',width:'24px',height:'24px'}} />
  <button data-id="submit" type="submit" style={{position:'relative',flex:'0 0 auto',order:'0',width:'160px',height:'40px'}}>Enviar</button>
 </form></main>`,{imports:["import FormTracker from '@/components/FormTracker';","import DeviceTracker from '@/components/DeviceTracker';"],tiles:[{id:'desktop',label:'Desktop',width:800}]})
 .file('components/FormTracker.tsx',FORM_TRACKER_COMPONENT).file('components/DeviceTracker.tsx',DEVICE_TRACKER_COMPONENT).build();
 await editor.load(source);await editor.select(['tracker']);
 const row=page.getByText('Trigger',{exact:true}).locator('xpath=ancestor::*[.//select][1]');const select=row.locator('select');await expect(select).toBeVisible();
 const before=await editor.code();await select.selectOption('success');await expect.poll(()=>editor.attr('tracker','triggerMode')).toBe('success');await expect(editor).toUndoInOneStep(before);
 await page.reload();await editor.waitForCanvas();await editor.settled();await expect.poll(()=>editor.attr('tracker','triggerMode')).toBe('success');
 expect(requests).toEqual([]);
 await page.locator('[data-tutorial="header-preview-button"]').click();const frame=page.frameLocator('[data-preview-overlay] iframe');
 await expect(frame.locator('input[name="deviceData_ip"]')).toHaveValue('203.0.113.9');
 await frame.locator('button[type="submit"]').click();
 await expect.poll(()=>frame.locator('form').evaluate(()=>{const w=window as Window & {dataLayer?:IArguments[]};return (w.dataLayer||[]).filter(x=>x[0]==='event'&&x[1]==='generate_lead').length;})).toBe(1);
 await expect.poll(()=>frame.locator('form').evaluate(()=>{const w=window as Window & {fbq?:{queue?:IArguments[]}};return (w.fbq?.queue||[]).filter(x=>x[0]==='track'&&x[1]==='Lead').length;})).toBe(1);
 expect(requests).toContain('ip');expect(requests).toContain('google');expect(requests).toContain('facebook');
 const exported=await page.evaluate(async files=>{const {buildSourceExport}=await import(/* @vite-ignore */ '/src/code/project/source-export.ts');return buildSourceExport(files,{name:'Tracker',runtimeRange:'^0.0.32'});},await editor.snapshotFiles());
 expect(exported.files['app/page.client.tsx']).toContain('triggerMode="success"');expect(exported.files['components/DeviceTracker.tsx']).toContain('RevymeDeviceTracker');
});
