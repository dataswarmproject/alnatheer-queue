import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, Snapshot, Ticket, Role } from '@saraf/queue-core';
import '../../bridge';
import type { DeviceMode } from '../../setup-contract';
import { mergeIssuedTicket } from './issued-ticket';

export function useQueue() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [connected, setConnected] = useState(false),
    [online, setOnline] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role | undefined>();
  const [setupMode, setSetupMode] = useState<DeviceMode | undefined>();
  const [companion, setCompanion] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]),
    [expanded, setExpanded] = useState(true),
    [switching, setSwitching] = useState(false);
  const [issued, setIssued] = useState<Ticket | null>(null);
  const fetching = useRef<Promise<void> | null>(null),
    generation = useRef(0),
    pending = useRef<Command | null>(null),
    acting = useRef(false);
  const viewVersion = useRef(0);
  useEffect(() => window.queue.onViewChange(setExpanded), []);
  const refresh = useCallback(async (force = false) => {
    if (fetching.current) {
      await fetching.current;
      if (!force) return;
    }
    const version = generation.current;
    const operation = (async () => {
      try {
        const next = await window.queue.snapshot();
        if (version === generation.current) {
          setSnapshot(previous =>
            previous && previous.actor.id === next.actor.id && previous.revision > next.revision
              ? previous
              : next,
          );
          setOnline(true);
          setIssued(previous => mergeIssuedTicket(previous, next));
        }
      } catch {
        if (version === generation.current) setOnline(false);
      }
    })();
    fetching.current = operation;
    try {
      await operation;
    } finally {
      if (fetching.current === operation) fetching.current = null;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    window.queue.connection().then(async info => {
      if (!alive) return;
      setConnected(info.configured);
      setRole(info.role);
      setSetupMode(info.mode);
      setCompanion(info.companion ?? false);
      setFavorites(await window.queue.preferences());
      if (info.configured) await refresh();
    });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!connected) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [connected, refresh]);
  useEffect(() => {
    if (snapshot?.actor.role === 'teller') setExpanded(false);
  }, [snapshot?.actor.id]);
  const expand = async (value: boolean) => {
    const version = ++viewVersion.current;
    setSwitching(true);
    try {
      await window.queue.expand(value);
      if (version === viewVersion.current) setExpanded(value);
    } finally {
      if (version === viewVersion.current) setSwitching(false);
    }
  };
  const perform = async (command: Command) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    pending.current = command;
    const version = generation.current;
    try {
      const result = await window.queue.command(command);
      if (version !== generation.current) return;
      pending.current = null;
      if (command.action === 'issue') setIssued(result.ticket);
      await refresh(true);
      return result;
    } catch (e) {
      if (version !== generation.current) return;
      const message = e instanceof Error ? e.message : 'تعذر تنفيذ العملية';
      if (/\[HTTP_4\d\d\]/.test(message)) pending.current = null;
      setError(message);
      if (snapshot?.actor.role === 'teller') await expand(true);
      throw e;
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  const action = async (action: Command['action'], serviceId?: string) => {
    if (pending.current) throw new Error('أعِد محاولة الطلب السابق أولًا للتحقق من نتيجته.');
    const command = {
      requestId: crypto.randomUUID(),
      action,
      expectedRevision: snapshot?.counter?.revision ?? 0,
      ...(serviceId ? { serviceId } : {}),
      ...(action === 'issue' ? { requirePrint: true } : {}),
    } as Command;
    return perform(command);
  };
  return {
    snapshot,
    role,
    setupMode,
    companion,
    connected,
    online,
    error,
    busy: busy || switching,
    favorites,
    expanded,
    issued,
    setIssued,
    refresh,
    expand,
    action,
    setError,
    retry: async () => {
      setError('');
      return pending.current ? perform(pending.current) : refresh(true);
    },
    connect: async (url: string, token: string, mode?: DeviceMode) => {
      await window.queue.connect({ url, token, ...(mode ? { mode } : {}) });
      generation.current++;
      setIssued(null);
      pending.current = null;
      setConnected(true);
      setSetupMode(mode);
      setError('');
      await refresh();
    },
    adoptConnection: async () => {
      generation.current++;
      const info = await window.queue.connection();
      setConnected(info.configured);
      setRole(info.role);
      setSetupMode(info.mode);
      setIssued(null);
      pending.current = null;
      setSnapshot(null);
      setError('');
      await refresh(true);
    },
    disconnect: async () => {
      generation.current++;
      await window.queue.disconnect();
      setIssued(null);
      pending.current = null;
      setSnapshot(null);
      setSetupMode(undefined);
      setConnected(false);
      setOnline(false);
      setExpanded(true);
    },
    toggleFavorite: async (id: string) => {
      const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id];
      await window.queue.favorites(next);
      setFavorites(next);
    },
  };
}
export type QueueController = ReturnType<typeof useQueue>;
