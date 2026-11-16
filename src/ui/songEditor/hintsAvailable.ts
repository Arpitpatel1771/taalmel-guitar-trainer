// Pitch hints listen to the video through tab-audio capture, which needs getDisplayMedia. Browsers
// without it (phones) don't show the feature at all; the check is the capability, never the device.

export function hintsAvailable(nav: { mediaDevices?: { getDisplayMedia?: unknown } } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return !!nav?.mediaDevices?.getDisplayMedia;
}
