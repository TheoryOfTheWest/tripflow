import type { Entry, Place, TripDocument } from '../models';
import { dailyEntries } from './time';
export function routePoints(doc: TripDocument, date?: string) {
  const entries = date
    ? dailyEntries(doc.entries, date, doc.trip.defaultTimezone).map((i) => i.entry)
    : [...doc.entries].sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
  const points: { place: Place; entry: Entry; time: string; station: boolean }[] = [];
  for (const entry of entries) {
    const refs =
      entry.type === 'transport'
        ? [entry.originPlaceId, entry.destinationPlaceId]
        : [entry.placeId, entry.endPlaceId];
    refs.forEach((ref, index) => {
      const place = doc.places.find((p) => p.id === ref);
      if (!place) return;
      // Keep repeat visits; collapse only identical consecutive endpoint of a leg.
      if (points.at(-1)?.place.id === place.id && index === 0) return;
      points.push({
        place,
        entry,
        time: index === 1 ? entry.endAtUtc : entry.startAtUtc,
        station: place.category === 'station',
      });
    });
  }
  return points;
}
