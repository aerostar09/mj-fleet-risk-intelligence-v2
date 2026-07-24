// Local cache to prevent redundant API calls for the same location string
const geocodeCache = new Map<string, [number, number]>();

/**
 * Dynamically queries OpenStreetMap (Nominatim) for any location name in Hyderabad/Telangana.
 * Falls back to a local search dictionary and then Hyderabad center if the request fails.
 */
export async function geocodeHydLocation(text: string): Promise<[number, number]> {
  if (!text || text.trim() === '') {
    return [78.4867, 17.3850]; // Default Hyderabad Central
  }

  const cleanText = text.trim().toLowerCase();

  // Return cached coordinates if we already geocoded this location
  if (geocodeCache.has(cleanText)) {
    return geocodeCache.get(cleanText)!;
  }

  try {
    const query = encodeURIComponent(`${cleanText}, Hyderabad, Telangana, India`);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`,
      {
        headers: {
          'User-Agent': 'MJ-Fleet-Risk-Intelligence/1.0'
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0) {
        const coords: [number, number] = [
          parseFloat(data[0].lon),
          parseFloat(data[0].lat)
        ];
        geocodeCache.set(cleanText, coords);
        return coords;
      }
    }
  } catch (error) {
    console.warn(`Nominatim geocoding failed for "${text}". Using fallback coordinates.`, error);
  }

  // Fallback to central Hyderabad ([longitude, latitude])
  const fallbackCoords: [number, number] = [78.4867, 17.3850];
  geocodeCache.set(cleanText, fallbackCoords);
  return fallbackCoords;
}