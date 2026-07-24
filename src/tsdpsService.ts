import { geocodeHydLocation } from './geocoder';

export interface WeatherHazardAlert {
  id: string;
  title: string;
  source: 'TSDPS_AWS';
  coordinates: [number, number];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskLevel: 'CLEAR' | 'WATERLOGGED' | 'HIGH RISK' | 'IMPASSABLE';
  description: string;
}

/**
 * Fetches hourly AWS rainfall data from TSDPS (Telangana Open Data Platform)
 * and turns high-rainfall mandals (>10 mm/h) into map hazards.
 * Uses async OpenStreetMap geocoding for precise location coordinates.
 */
export async function fetchTsdpsRainfallHazards(): Promise<WeatherHazardAlert[]> {
  try {
    const endpoint = 'https://data.telangana.gov.in/api/1/rest/action/datastore_search?resource_id=tsdps_hourly_weather';
    const response = await fetch(endpoint);

    if (!response.ok) {
      throw new Error(`TSDPS API error: ${response.status}`);
    }

    const data = await response.json();
    const records: any[] = data.result?.records || [];

    // Filter for Hyderabad & Rangareddy mandals
    const hydStations = records.filter(
      (r) => r.district === 'HYDERABAD' || r.district === 'RANGAREDDY'
    );

    const hazardAlerts: WeatherHazardAlert[] = [];

    // Loop through stations asynchronously to await OpenStreetMap geocoding
    for (const [index, station] of hydStations.entries()) {
      const rainfall = parseFloat(station.rainfall_mm || station.rain || '0');

      if (rainfall > 10) {
        const locationName = station.mandal || station.location || 'Hyderabad';
        const coords = await geocodeHydLocation(locationName);
        
        let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';
        let riskLevel: 'CLEAR' | 'WATERLOGGED' | 'HIGH RISK' | 'IMPASSABLE' = 'WATERLOGGED';

        if (rainfall > 35) {
          severity = 'CRITICAL';
          riskLevel = 'IMPASSABLE';
        } else if (rainfall > 20) {
          severity = 'HIGH';
          riskLevel = 'HIGH RISK';
        }

        hazardAlerts.push({
          id: `tsdps_aws_${station.mandal}_${index}`,
          title: `TSDPS Rain Alert: ${locationName}`,
          source: 'TSDPS_AWS',
          coordinates: coords,
          severity,
          riskLevel,
          description: `AWS Station recorded ${rainfall} mm/h rainfall in ${locationName}. Urban waterlogging risk.`
        });
      }
    }

    return hazardAlerts;
  } catch (error) {
    console.warn('TSDPS Open Data API fallback.', error);
    return [];
  }
}