export type DesktopSpeechStatus = {
  configured: boolean;
  cachedOnly: boolean;
  restartRequired?: boolean;
};
export function freeSpeechPolicy(
  status: DesktopSpeechStatus,
  freeLibraryAvailable: boolean,
): DesktopSpeechStatus {
  if (freeLibraryAvailable && (!status.configured || !status.cachedOnly))
    return { configured: false, cachedOnly: true, restartRequired: true };
  return status;
}
export function requireFreeSpeech(status: DesktopSpeechStatus, freeLibraryAvailable: boolean) {
  if (freeSpeechPolicy(status, freeLibraryAvailable).restartRequired)
    throw new Error('FREE_VOICE_RESTART_REQUIRED');
}
