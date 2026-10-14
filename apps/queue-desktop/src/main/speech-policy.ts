import { speechStatusSchema } from '@saraf/queue-core/speech';
import { localVoiceAvailable } from './local-voice-library';
import { freeSpeechPolicy, requireFreeSpeech } from '../speech-policy';

export async function desktopSpeechStatus(read: () => Promise<unknown>) {
  return freeSpeechPolicy(speechStatusSchema.parse(await read()), await localVoiceAvailable());
}
export async function guardFreeSpeech(read: () => Promise<unknown>) {
  if (await localVoiceAvailable()) requireFreeSpeech(speechStatusSchema.parse(await read()), true);
}
