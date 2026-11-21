'use client';
import { useEffect, useState, type HTMLAttributes } from 'react';
export interface DeviceTrackerProps extends HTMLAttributes<HTMLSpanElement> { fieldName?:string; trackingHosts?:string; showData?:boolean; static?:boolean }
export function deviceMetadata(userAgent: string) {
 let browser='Unknown', browserVersion='Unknown', os='Unknown', osVersion='Unknown';
 const browserPatterns: Array<[string,RegExp]>=[['Firefox',/Firefox\/([0-9.]+)/],['Opera',/(?:Opera|OPR)\/([0-9.]+)/],['Edge',/(?:Edge|Edg)\/([0-9.]+)/],['Chrome',/Chrome\/([0-9.]+)/],['Safari',/Version\/([0-9.]+).*Safari/]];
 for(const [name,pattern] of browserPatterns){const match=userAgent.match(pattern);if(match){browser=name;browserVersion=match[1];break;}}
 if(userAgent.includes('Win')) {os='Windows';if(userAgent.includes('Windows NT 10.0'))osVersion='10';else if(userAgent.includes('Windows NT 11.0'))osVersion='11';}
 else if(userAgent.includes('Mac')){os='macOS';osVersion=(userAgent.match(/Mac OS X ([0-9_]+)/)?.[1]||'Unknown').replace(/_/g,'.');}
 else if(userAgent.includes('Android')){os='Android';osVersion=userAgent.match(/Android ([0-9.]+)/)?.[1]||'Unknown';}
 else if(/iPhone|iPad|iPod/.test(userAgent)){os='iOS';osVersion=(userAgent.match(/OS ([0-9_]+)/)?.[1]||'Unknown').replace(/_/g,'.');}
 else if(userAgent.includes('Linux'))os='Linux';
 return {browser:`${browser} ${browserVersion}`,os:`${os} ${osVersion}`};
}
/** Framer's three hidden fields; never calls IP discovery in editor or preview hosts. */
export function RevymeDeviceTracker({fieldName='deviceData',trackingHosts='',showData=false,static:isStatic=false,style,...props}:DeviceTrackerProps) {
 const [data,setData]=useState<{ip:string;browser:string;os:string}|null>(null);
 useEffect(()=>{
  if(isStatic || !/^[A-Za-z][\w-]{0,49}$/.test(fieldName) || !trackingHosts.split(',').map(h=>h.trim().toLowerCase()).filter(Boolean).includes(window.location.hostname.toLowerCase())) {setData(null);return;}
  const controller=new AbortController();const browser=deviceMetadata(navigator.userAgent);let mounted=true;
  void fetch('https://api.ipify.org?format=json',{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('IP lookup unavailable');const body=await response.json();return typeof body.ip==='string'?body.ip:'Unknown';}).catch(()=> 'Unknown').then(ip=>{if(mounted)setData({ip,...browser});});
  return ()=>{mounted=false;controller.abort();};
 },[fieldName,trackingHosts,isStatic]);
 return <span {...props} data-revyme-device-tracker="" style={style}>{isStatic ? "Device fields" : null}{data && (showData ? <span>{data.ip} · {data.browser} · {data.os}</span> : <>
  <input type="hidden" name={`${fieldName}_ip`} value={data.ip} />
  <input type="hidden" name={`${fieldName}_browser`} value={data.browser} />
  <input type="hidden" name={`${fieldName}_os`} value={data.os} />
 </>)}</span>;
}
