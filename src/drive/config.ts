// Google Drive configuration, read from Vite env vars (see specs/28-10-drive-sync.md).
// When any of them is missing, Drive sync is "Not configured" and nothing else changes.

export interface DriveConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

export function getDriveConfig(): DriveConfig {
  return {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "",
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? "",
    appId: import.meta.env.VITE_GOOGLE_APP_ID ?? "",
  };
}

export function isDriveConfigured(): boolean {
  const { clientId, apiKey, appId } = getDriveConfig();
  return Boolean(clientId && apiKey && appId);
}
