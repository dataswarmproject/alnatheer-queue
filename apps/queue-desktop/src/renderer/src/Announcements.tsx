import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@saraf/queue-core';
import { announcementText, speechTestText, type SpeechRequest } from '@saraf/queue-core/speech';
import { playAnnouncement, playQueueAlert } from './play-announcement';
import type { DesktopSpeechStatus } from '../../speech-policy';
import type { AudioSettings } from '../../audio-contract';
import { spokenAnnouncementsEnabled } from '../../audio-contract';
export type CallPhase = 'preparing' | 'started' | 'finished' | 'stopped';
export function Announcements({
  snapshot,
  onCallingChange,
}: {
  snapshot: Snapshot;
  onCallingChange?: (sequence: number | null, phase: CallPhase) => void;
}) {
  const callingListener = useRef(onCallingChange);
  callingListener.current = onCallingChange;
  const [settings, setSettings] = useState<AudioSettings | null>(null),
    last = useRef<number | null>(null),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [error, setError] = useState('');
  const pending = useRef<Snapshot['announcements']>([]),
    testing = useRef(false),
    current = useRef<object | null>(null),
    active = useRef(false),
    latest = useRef({ snapshot, receivedAt: performance.now() });
  const [natural, setNatural] = useState<DesktopSpeechStatus | null>(null);
  const mode =
    settings?.mode === 'auto'
      ? natural?.configured
        ? 'natural'
        : 'local'
      : (settings?.mode ?? 'local');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cleanupAudio = useRef<(() => void) | null>(null);
  const volume = useRef(1);
  volume.current = settings?.volume ?? 1;
  useEffect(() => {
    if (!spokenAnnouncementsEnabled) return;
    let alive = true;
    window.queue
      .speechStatus()
      .then(status => {
        if (alive) {
          setNatural(status);
        }
      })
      .catch(() => {
        if (alive) setError('تعذر التحقق من إعدادات خدمة الصوت.');
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!natural?.restartRequired) return;
    let alive = true;
    const timer = setInterval(() => {
      void window.queue
        .speechStatus()
        .then(status => {
          if (!alive) return;
          setNatural(status);
          if (status.configured && !status.restartRequired) {
            setError('');
          }
        })
        .catch(() => {});
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [natural?.restartRequired]);
  const voice =
    voices.find(v => v.voiceURI === settings?.voiceURI) ??
    voices.find(v => /^ar-SA$/i.test(v.lang)) ??
    voices[0];
  const selectedVoice = useRef(voice);
  selectedVoice.current = voice;
  const stop = (clearQueue = true) => {
    testing.current = false;
    callingListener.current?.(null, 'stopped');
    active.current = false;
    if (clearQueue) pending.current = [];
    current.current = null;
    cleanupAudio.current?.();
    cleanupAudio.current = null;
    speechSynthesis.cancel();
  };
  useEffect(() => {
    const load = () =>
      setVoices(
        speechSynthesis.getVoices().filter(v => v.localService && /^ar(?:-|$)/i.test(v.lang)),
      );
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  useEffect(() => {
    let alive = true,
      version = 0;
    const unsubscribe = window.queue.onAudioSettings(value => {
      version++;
      if (alive) setSettings(value);
    });
    const initialVersion = version;
    void window.queue
      .audioStatus()
      .then(status => {
        if (alive && version === initialVersion) setSettings(status.settings);
      })
      .catch(() => setError('تعذر تحميل إعدادات النداء.'));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const engineReady =
    spokenAnnouncementsEnabled && (mode === 'natural' ? !!natural?.configured : !!voice);
  const voiceEnabled = spokenAnnouncementsEnabled && (settings?.voiceEnabled ?? false);
  const alertEnabled = settings?.alertEnabled ?? true;
  const canVoice = voiceEnabled && engineReady;
  const ready = canVoice || alertEnabled;
  const voiceURI = mode === 'local' ? voice?.voiceURI : undefined;
  useEffect(() => {
    stop();
    setError('');
    if (settings?.enabled && ready && (voiceEnabled || alertEnabled)) active.current = true;
  }, [settings?.enabled, voiceEnabled, canVoice, alertEnabled, mode, voiceURI, ready]);
  const recover = (message: string) => {
    stop(false);
    active.current = !!settings?.enabled && ready && (voiceEnabled || alertEnabled);
    setError(message);
    queueMicrotask(drain);
  };
  useEffect(() => {
    void window.queue
      .reportAudio({
        mode: mode === 'natural' ? 'natural' : 'local',
        ready: engineReady,
        voiceURI: voice?.voiceURI ?? '',
        natural,
        voices: voices.map(v => ({ voiceURI: v.voiceURI, name: v.name })),
        error,
      })
      .catch(() => {});
  }, [mode, engineReady, natural, voices, voice, error]);
  const stillActive = (call: Snapshot['announcements'][number]) => {
    const state = latest.current;
    const age =
      Date.parse(state.snapshot.serverTime) +
      performance.now() -
      state.receivedAt -
      Date.parse(call.occurredAt);
    return (
      active.current &&
      age >= 0 &&
      age < 30000 &&
      state.snapshot.active.some(t => t.id === call.ticketId && t.counterId === call.counterId)
    );
  };
  const say = (
    text: string,
    next: () => void,
    input: SpeechRequest,
    call?: Snapshot['announcements'][number],
  ) => {
    setError('');
    if (!canVoice) {
      if (!alertEnabled) {
        next();
        return;
      }
      const token = {};
      current.current = token;
      cleanupAudio.current = playQueueAlert(
        () => {
          if (current.current !== token) return;
          callingListener.current?.(call?.sequence ?? null, 'finished');
          cleanupAudio.current = null;
          current.current = null;
          next();
        },
        () => {
          if (current.current === token)
            recover('تعذر تشغيل صوت التنبيه. تحقق من مخرج صوت شاشة العرض.');
        },
        () => {
          if (current.current === token && call)
            callingListener.current?.(call.sequence, 'started');
        },
        volume.current,
      );
      return;
    }
    if (modeRef.current === 'natural') {
      const token = {};
      current.current = token;
      if (call) callingListener.current?.(call.sequence, 'preparing');
      const finish = () => {
        if (current.current !== token) return;
        callingListener.current?.(call?.sequence ?? null, 'finished');
        cleanupAudio.current?.();
        cleanupAudio.current = null;
        current.current = null;
        next();
      };
      void window.queue
        .speech(input)
        .then(result => {
          if (current.current !== token) return;
          if (call && !stillActive(call)) {
            finish();
            return;
          }
          const fail = () => {
            if (current.current !== token) return;
            recover('تعذر تشغيل النداء الطبيعي. تحقق من مخرج صوت شاشة العرض ثم أعد التجربة.');
          };
          cleanupAudio.current = playAnnouncement(
            result,
            finish,
            fail,
            () => {
              if (call && current.current === token)
                callingListener.current?.(call.sequence, 'started');
            },
            () => {
              if (!call || stillActive(call)) return true;
              callingListener.current?.(null, 'stopped');
              return false;
            },
            volume.current,
            alertEnabled,
          );
        })
        .catch(error => {
          if (current.current !== token) return;
          if (String(error).includes('[HTTP_409]')) {
            finish();
            return;
          }
          recover(
            String(error).includes('FREE_VOICE_RESTART_REQUIRED')
              ? 'لتفعيل النداء العربي، أعد تشغيل خادم الفرع بعد تحديثه.'
              : 'هذا النداء غير متاح. تحقق من مكتبة النداءات على خادم الفرع أو استخدم صوت الجهاز مؤقتًا.',
          );
        });
      return;
    }
    if (!selectedVoice.current) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selectedVoice.current;
    utterance.lang = selectedVoice.current.lang;
    utterance.rate = 0.9;
    utterance.volume = volume.current;
    current.current = utterance;
    utterance.onstart = () => {
      if (call && current.current === utterance)
        callingListener.current?.(call.sequence, 'started');
    };
    utterance.onend = () => {
      if (current.current !== utterance) return;
      callingListener.current?.(call?.sequence ?? null, 'finished');
      current.current = null;
      next();
    };
    utterance.onerror = () => {
      if (current.current !== utterance) return;
      recover('تعذر تشغيل الصوت. تحقق من الصوت العربي ومخرج صوت شاشة العرض، ثم أعد التجربة.');
    };
    const speak = () => {
      if (current.current !== utterance) return;
      cleanupAudio.current = null;
      if (call && !stillActive(call)) {
        current.current = null;
        callingListener.current?.(null, 'stopped');
        next();
        return;
      }
      try {
        speechSynthesis.speak(utterance);
      } catch {
        recover('تعذر تشغيل الصوت العربي.');
      }
    };
    if (!alertEnabled) {
      speak();
      return;
    }
    cleanupAudio.current = playQueueAlert(
      speak,
      () => {
        if (current.current === utterance) {
          recover('تعذر تشغيل صوت تنبيه النداء.');
        }
      },
      () => {
        if (call && current.current === utterance)
          callingListener.current?.(call.sequence, 'started');
      },
      volume.current,
    );
  };
  const drain = () => {
    if (
      !active.current ||
      current.current ||
      (canVoice && modeRef.current === 'local' && !selectedVoice.current)
    )
      return;
    while (pending.current.length) {
      const call = pending.current.shift()!;
      const currentSnapshot = latest.current.snapshot;
      const age =
        Date.parse(currentSnapshot.serverTime) +
        performance.now() -
        latest.current.receivedAt -
        Date.parse(call.occurredAt);
      if (
        age < 0 ||
        age >= 30000 ||
        !currentSnapshot.active.some(t => t.id === call.ticketId && t.counterId === call.counterId)
      )
        continue;
      say(announcementText(call), drain, { sequence: call.sequence }, call);
      return;
    }
  };
  useEffect(
    () =>
      window.queue.onAudioTest(() => {
        if (!ready) return;
        stop();
        testing.current = true;
        setError('');
        say(
          speechTestText,
          () => {
            testing.current = false;
            active.current = !!settings?.enabled && (voiceEnabled || alertEnabled);
            drain();
          },
          { test: true },
        );
      }),
    [settings, ready, canVoice, mode, voice],
  );
  useEffect(() => {
    latest.current = { snapshot, receivedAt: performance.now() };
    if (last.current === null) {
      last.current = snapshot.announcements.at(-1)?.sequence ?? 0;
      return;
    }
    const next = snapshot.announcements.filter(
      a =>
        a.sequence > last.current! &&
        (!snapshot.actor.counterId || snapshot.actor.counterId === a.counterId) &&
        snapshot.active.some(t => t.id === a.ticketId && t.counterId === a.counterId) &&
        Date.parse(snapshot.serverTime) - Date.parse(a.occurredAt) < 30000,
    );
    last.current = snapshot.announcements.at(-1)?.sequence ?? last.current;
    if (testing.current && next.length) {
      stop(false);
      active.current = !!settings?.enabled && ready;
    }
    if (!active.current) return;
    pending.current = [...pending.current, ...next].slice(-50);
    drain();
  }, [snapshot]);
  useEffect(
    () => () => {
      speechSynthesis.cancel();
      active.current = false;
      pending.current = [];
      current.current = null;
      cleanupAudio.current?.();
      cleanupAudio.current = null;
    },
    [],
  );
  return null;
}
