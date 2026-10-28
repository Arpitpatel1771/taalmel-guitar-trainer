// Google Identity Services (token model) behind a small interface so tests can fake it.
// Tokens live in memory only. Silent requests never open a popup: if Google needs
// interaction they reject with AuthRequiredError and the UI asks the user to click.

import { getDriveConfig } from "./config";

export const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file email profile";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
/** Refresh when the token is within this long of expiring. */
export const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

/** Thrown by a silent getToken when Google needs the user to interact. */
export class AuthRequiredError extends Error {
  constructor(message = "Google sign-in is required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export interface DriveProfile {
  email: string;
  name: string | null;
  picture: string | null;
}

export const PROFILE_KEY = "taalmel.driveProfile";

/** Parses a userinfo response; null when it has no email. */
export function parseProfile(data: unknown): DriveProfile | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const email = str(d.email);
  if (!email) return null;
  return { email, name: str(d.name) ?? str(d.given_name), picture: str(d.picture) };
}

/** Per-device display cache so the chip can render before the network answers. */
export function loadCachedProfile(): DriveProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? parseProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveCachedProfile(p: DriveProfile | null): void {
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Display cache only.
  }
}

export interface DriveAuth {
  /** Resolves with a valid access token. Interactive requests must run inside a user gesture. */
  getToken(opts: { interactive: boolean }): Promise<string>;
  /** Called when the connected state (token / email) changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  email(): string | null;
  profile(): DriveProfile | null;
  signOut(): void;
}

// Minimal declarations for the GIS globals we use.
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (resp: GisTokenResponse) => void;
  error_callback?: (err: { type?: string; message?: string }) => void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: GisTokenClientConfig): GisTokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

let gisPromise: Promise<GoogleGlobal> | null = null;

function loadGis(): Promise<GoogleGlobal> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<GoogleGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google);
      else {
        gisPromise = null;
        reject(new Error("Google sign-in failed to load."));
      }
    };
    script.onerror = () => {
      gisPromise = null;
      reject(new Error("Could not load Google sign-in. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

export class GisDriveAuth implements DriveAuth {
  private token: string | null = null;
  private expiresAt = 0;
  private prof: DriveProfile | null = loadCachedProfile();
  private consented = false;
  private client: GisTokenClient | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void; interactive: boolean } | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly clientId: string = getDriveConfig().clientId) {}

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  email(): string | null {
    return this.prof?.email ?? null;
  }

  profile(): DriveProfile | null {
    return this.prof;
  }

  signOut(): void {
    const token = this.token;
    this.token = null;
    this.expiresAt = 0;
    this.prof = null;
    saveCachedProfile(null);
    this.consented = false;
    if (token) window.google?.accounts.oauth2.revoke(token);
    this.emit();
  }

  async getToken(opts: { interactive: boolean }): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - TOKEN_REFRESH_MARGIN_MS) return this.token;
    const token = await this.request(opts.interactive);
    return token;
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }

  private async request(interactive: boolean): Promise<string> {
    const google = await loadGis();
    if (!this.client) {
      this.client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPES,
        callback: (resp) => this.onResponse(resp),
        error_callback: (err) => this.fail(err.type === "popup_closed" ? "popup_closed" : (err.type ?? "error"), err.message),
      });
    }
    this.pending?.reject(new AuthRequiredError("Superseded by a newer sign-in request."));
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject, interactive };
      const prompt = interactive && !this.consented ? "consent" : "";
      this.client!.requestAccessToken({ prompt });
    });
  }

  private onResponse(resp: GisTokenResponse): void {
    if (resp.error || !resp.access_token) {
      this.fail(resp.error ?? "no_token", resp.error_description);
      return;
    }
    this.token = resp.access_token;
    this.expiresAt = Date.now() + Number(resp.expires_in ?? 3600) * 1000;
    this.consented = true;
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(resp.access_token);
    void this.fetchProfile(resp.access_token);
    this.emit();
  }

  private fail(code: string, message?: string): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    // Silent failures (login_required, interaction_required, popup blocked...) all mean "ask the user".
    if (!pending.interactive) pending.reject(new AuthRequiredError());
    else pending.reject(new Error(message ?? `Google sign-in failed (${code}).`));
  }

  private async fetchProfile(token: string): Promise<void> {
    try {
      const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const next = parseProfile(await res.json());
      if (next && JSON.stringify(next) !== JSON.stringify(this.prof)) {
        this.prof = next;
        saveCachedProfile(next);
        this.emit();
      }
    } catch {
      // The profile is cosmetic; ignore failures.
    }
  }
}
