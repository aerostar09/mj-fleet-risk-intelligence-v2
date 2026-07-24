import type { VercelRequest, VercelResponse } from '@vercel/node';

const POLICE_LANDMARKS: Record<string, [number, number]> = {
  'begumpet': [78.4611, 17.4435],
  'hitec city': [78.3772, 17.4435],
  'gachibowli': [78.3614, 17.4401],
  'dilsukhnagar': [78.5280, 17.3688],
  'lakdikapul': [78.4636, 17.4018],
  'malakpet': [78.4983, 17.3718],
  'secunderabad': [78.4983, 17.4399],
  'malkajgiri': [78.5320, 17.4478],
  'khairatabad': [78.4593, 17.4116],
  'punjagutta': [78.4482, 17.4265],
};

function geocode(text: string): [number, number] {
  const lower = text.toLowerCase();
  for (const [key, coords] of Object.entries(POLICE_LANDMARKS)) {
    if (lower.includes(key)) return coords;
  }
  return [78.4867, 17.3850];
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { alert_text, source_channel } = req.body || {};

  if (!alert_text) {
    return res.status(400).json({ error: 'Missing alert_text payload.' });
  }

  const lowerAlert = alert_text.toLowerCase();

  const isWaterlogged = lowerAlert.includes('waterlog') || lowerAlert.includes('water logged');
  const isTreeFall = lowerAlert.includes('tree fall') || lowerAlert.includes('uprooted');
  const isTrafficSlow = lowerAlert.includes('slow movement') || lowerAlert.includes('jam');

  if (!isWaterlogged && !isTreeFall && !isTrafficSlow) {
    return res.status(200).json({ message: 'No critical hazard keywords detected.' });
  }

  const coords = geocode(alert_text);

  const hazardMarker = {
    id: `police_advisory_${Date.now()}`,
    title: `Police Advisory: ${alert_text.slice(0, 35)}...`,
    source: source_channel || 'Cyberabad Traffic Police',
    coordinates: coords,
    severity: isWaterlogged ? 'CRITICAL' : 'HIGH',
    riskLevel: isWaterlogged ? 'IMPASSABLE' : 'HIGH RISK',
    description: alert_text,
    timestamp: new Date().toISOString()
  };

  return res.status(200).json({
    success: true,
    hazard: hazardMarker
  });
}