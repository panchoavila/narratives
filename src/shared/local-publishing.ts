// Public publishing state. Credentials only exist in the local server.
export interface SiteDeployment {
  id: string;
  target: 'preview' | 'production';
  state: 'UPLOADING' | 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';
  url?: string;
  inspectorUrl?: string;
  createdAt: string;
  error?: string;
  sourceHash?: string;
}

export interface LocalPublishingState {
  connected: boolean;
  hasCredentials: boolean;
  project?: { id: string; name: string; teamId?: string };
  deployment?: SiteDeployment;
  preview?: SiteDeployment;
  production?: SiteDeployment;
}

export function deploymentPending(deployment?: SiteDeployment): boolean {
  return !!deployment && !['READY', 'ERROR', 'CANCELED'].includes(deployment.state);
}

export interface PublishingDomain {
  name: string;
  verified: boolean;
  configured: boolean | null;
  records: Array<{ type: string; name: string; value: string }>;
  error?: string;
}
