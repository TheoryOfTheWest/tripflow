import { useCallback, useEffect, useRef, useState } from 'react';
import type { TripDocument } from '../models';
import {
  cachedDocuments,
  loadDocuments,
  saveDocument,
  deleteDocument,
  LOCAL_OWNER,
} from '../services/repository';
import { message } from '../lib/utils';
export function useTrips(ownerId: string) {
  const [docs, setDocs] = useState<TripDocument[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [cached, setCached] = useState(false);
  const generation = useRef(0);
  const [loadedOwner, setLoadedOwner] = useState(ownerId);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    setLoadedOwner(ownerId);
    setLoading(true);
    setError('');
    setCached(false);
    setDocs([]);
    try {
      const recent = await cachedDocuments(ownerId).catch((e) => {
        if (ownerId === LOCAL_OWNER) throw e;
        return [];
      });
      if (generation.current !== token) return;
      setDocs(recent);
      try {
        const loaded = await loadDocuments(ownerId);
        if (generation.current === token) {
          setDocs(loaded);
          setCached(false);
        }
      } catch (e) {
        if (generation.current === token) {
          setError(message(e));
          setCached(ownerId !== LOCAL_OWNER);
        }
      }
    } catch (e) {
      if (generation.current === token) setError(message(e));
    } finally {
      if (generation.current === token) setLoading(false);
    }
  }, [ownerId]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  async function save(doc: TripDocument) {
    if (doc.trip.ownerId !== ownerId) throw new Error('账户已切换，请重新打开编辑');
    const token = generation.current;
    const saved = await saveDocument(doc);
    if (token === generation.current)
      setDocs((list) => [saved, ...list.filter((d) => d.trip.id !== saved.trip.id)]);
    return saved;
  }
  async function remove(doc: TripDocument) {
    const warning = await deleteDocument(doc);
    setDocs((list) => list.filter((d) => d.trip.id !== doc.trip.id));
    return warning;
  }
  return {
    docs: loadedOwner === ownerId ? docs : [],
    loading: loading || loadedOwner !== ownerId,
    error: loadedOwner === ownerId ? error : '',
    cached,
    refresh,
    save,
    remove,
  };
}
