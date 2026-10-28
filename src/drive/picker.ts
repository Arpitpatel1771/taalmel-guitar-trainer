// Google Picker for "Import from Drive" (spec §3). Loaded on demand, no npm deps.

import { getDriveConfig } from "./config";

const API_SRC = "https://apis.google.com/js/api.js";

interface PickerDoc {
  id: string;
}
interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
}
interface PickerView {
  setMimeTypes(types: string): PickerView;
  setIncludeFolders(v: boolean): PickerView;
}
interface PickerBuilder {
  addView(v: PickerView): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  enableFeature(f: string): PickerBuilder;
  setCallback(cb: (r: PickerResponse) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
interface PickerGlobal {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new () => PickerView;
  Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string };
}
interface GapiGlobal {
  load(name: string, cb: () => void): void;
}
declare global {
  interface Window {
    gapi?: GapiGlobal;
  }
}

let pickerPromise: Promise<PickerGlobal> | null = null;

function loadPicker(): Promise<PickerGlobal> {
  if (pickerPromise) return pickerPromise;
  pickerPromise = new Promise<PickerGlobal>((resolve, reject) => {
    const fail = (msg: string) => {
      pickerPromise = null;
      reject(new Error(msg));
    };
    const ready = () => window.gapi!.load("picker", () => resolve((window.google as unknown as { picker: PickerGlobal }).picker));
    if (window.gapi) return ready();
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.onload = () => (window.gapi ? ready() : fail("Google Picker failed to load."));
    script.onerror = () => fail("Could not load Google Picker. Check your connection.");
    document.head.appendChild(script);
  });
  return pickerPromise;
}

/** Opens the picker; resolves with the picked file ids (empty when cancelled). */
export async function pickDriveFiles(token: string): Promise<string[]> {
  const picker = await loadPicker();
  const { apiKey, appId } = getDriveConfig();
  return new Promise<string[]>((resolve) => {
    const view = new picker.DocsView().setIncludeFolders(true).setMimeTypes("text/plain,video/*,audio/*");
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setCallback((r) => {
        if (r.action === picker.Action.PICKED) resolve((r.docs ?? []).map((d) => d.id));
        else if (r.action === picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}
