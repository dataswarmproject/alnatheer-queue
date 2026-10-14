import type { SpeechAudio } from '@saraf/queue-core/speech';

const bytes = (audio: string) => Uint8Array.from(atob(audio), char => char.charCodeAt(0));
export function playQueueAlert(
  ended: () => void,
  failed: () => void,
  started: () => void,
  volume = 1,
): () => void {
  const audio = new Audio('/queue-alert-sound.mp3');
  audio.volume = volume;
  let canceled = false;
  const timer = setTimeout(() => {
    if (!canceled) {
      stop();
      failed();
    }
  }, 10000);
  const stop = () => {
    canceled = true;
    clearTimeout(timer);
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
  };
  audio.onplaying = () => {
    if (!canceled) started();
  };
  audio.onended = () => {
    if (!canceled) {
      stop();
      ended();
    }
  };
  const fail = () => {
    if (!canceled) {
      stop();
      failed();
    }
  };
  audio.onerror = fail;
  void audio.play().catch(fail);
  return stop;
}
/** Schedule complete phrase buffers, with one deliberate 120 ms sentence pause. */
export function playAnnouncement(
  recording: SpeechAudio,
  ended: () => void,
  failed: () => void,
  started: () => void = () => {},
  maySpeak: () => boolean = () => true,
  volume = 1,
  alertEnabled = true,
): () => void {
  let canceled = false,
    context: AudioContext | undefined,
    element: HTMLAudioElement | undefined,
    url: string | undefined;
  let cancelAlert: (() => void) | undefined, settleAlert: (() => void) | undefined;
  const sources: AudioBufferSourceNode[] = [];
  const timer = setTimeout(() => {
    if (!canceled) failed();
  }, 30000);
  const stop = () => {
    canceled = true;
    clearTimeout(timer);
    cancelAlert?.();
    settleAlert?.();
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
    }
    if (context) void context.close().catch(() => {});
    if (element) {
      element.onplaying = null;
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.removeAttribute('src');
    }
    if (url) URL.revokeObjectURL(url);
  };
  void (async () => {
    if (alertEnabled)
      await new Promise<void>((resolve, reject) => {
        settleAlert = resolve;
        cancelAlert = playQueueAlert(
          resolve,
          () => reject(new Error('Queue alert playback failed')),
          started,
          volume,
        );
      });
    if (canceled) return;
    if (!maySpeak()) {
      ended();
      return;
    }
    if ('audio' in recording) {
      url = URL.createObjectURL(new Blob([bytes(recording.audio)], { type: recording.mime }));
      element = new Audio(url);
      element.volume = volume;
      element.onplaying = () => {
        if (!canceled) started();
      };
      element.onended = () => {
        if (!canceled) ended();
      };
      element.onerror = () => {
        if (!canceled) failed();
      };
      await element.play();
      return;
    }
    context = new AudioContext();
    await context.resume();
    const buffers = await Promise.all(
      recording.segments.map(segment => context!.decodeAudioData(bytes(segment.audio).buffer)),
    );
    if (canceled) return;
    let start = context.currentTime + 0.05;
    buffers.forEach((buffer, index) => {
      if (buffer.duration <= 0 || buffer.duration > 20)
        throw new Error('Invalid announcement segment');
      const source = context!.createBufferSource(),
        gain = context!.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context!.destination);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.004);
      gain.gain.setValueAtTime(volume, start + Math.max(0.004, buffer.duration - 0.004));
      gain.gain.linearRampToValueAtTime(0, start + buffer.duration);
      if (index === buffers.length - 1)
        source.onended = () => {
          if (!canceled) ended();
        };
      sources.push(source);
      source.start(start);
      start += buffer.duration + 0.12;
    });
    started();
  })().catch(() => {
    if (!canceled) failed();
  });
  return stop;
}
