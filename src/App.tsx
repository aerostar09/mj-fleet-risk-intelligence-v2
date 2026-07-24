import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { createClient } from '@supabase/supabase-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { fetchTsdpsRainfallHazards } from './tsdpsService';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || "https://enwquyeqjoeguzcgjnlu.supabase.co";
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVud3F1eWVxam9lZ3V6Y2dqbmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM2MTg1OTUsImV4cCI6MjA2OTE5NDU5NX0.MDM4MDE1In30.AsozMTaDjKE4nCqNwmQZSRq_-hS7mHXaIpYOyuCD2kg";
const TOMTOM_API_KEY = (import.meta.env.VITE_TOMTOM_API_KEY as string) || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface Hazard {
  id: string;
  location_name: string;
  water_depth_level: string;
  description: string;
  lat: number;
  lng: number;
  source?: string;
}

const DEFAULT_STORM_HOTSPOTS: Hazard[] = [
  { id: 'sim-1', location_name: "Dilsukhnagar Underpass Waterlog", water_depth_level: "CRITICAL_IMPASSABLE", description: "Severe inundation (45cm water depth)", lng: 78.5281, lat: 17.3688, source: 'simulation' },
  { id: 'sim-2', location_name: "Malakpet RUB Severe Inundation", water_depth_level: "CRITICAL_IMPASSABLE", description: "Waterlogged railway underbridge corridor", lng: 78.4867, lat: 17.3850, source: 'simulation' },
  { id: 'sim-3', location_name: "Punjagutta Flyover Slip Road Hazard", water_depth_level: "CRITICAL_IMPASSABLE", description: "Blocked slip road due to pooling", lng: 78.4400, lat: 17.4300, source: 'simulation' },
  { id: 'sim-4', location_name: "Hitec City Mindspace Water Logging", water_depth_level: "CRITICAL_IMPASSABLE", description: "High risk IT hub commute blockage", lng: 78.3780, lat: 17.4435, source: 'simulation' }
];

export default function App() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [severity, setSeverity] = useState('CRITICAL_IMPASSABLE');
  const [rainStatus, setRainStatus] = useState<string>('Checking live rain...');
  const [isRaining, setIsRaining] = useState<boolean>(false);
  const [isSimulationActive, setIsSimulationActive] = useState<boolean>(false);
  const [activeHazardsCount, setActiveHazardsCount] = useState<number>(0);
  const [tomtomLive, setTomtomLive] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportCoords, setReportCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [reportName, setReportName] = useState('');

  // 1. OPEN-METEO LIVE RAIN API
  const fetchLiveWeather = async () => {
    if (isSimulationActive) return;

    try {
      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=17.3850&longitude=78.4867&current=precipitation,rain,showers&timezone=Asia%2FKolkata'
      );
      const data = await res.json();
      const currentRain = data.current?.rain ?? data.current?.precipitation ?? 0;

      if (currentRain > 0) {
        setIsRaining(true);
        setRainStatus(`🌧️ Live Rain Active: ${currentRain} mm/h`);
      } else {
        setIsRaining(false);
        setRainStatus(`☀️ Clear Weather (${currentRain} mm/h)`);
      }
    } catch {
      if (!isSimulationActive) {
        setRainStatus('⚠️ Weather feed standby');
      }
    }
  };

  // 2. TOMTOM HAZARDS (With formatted location titles)
  const fetchTomTomHazards = async () => {
    if (!TOMTOM_API_KEY) {
      setTomtomLive(false);
      return;
    }
    try {
      const bbox = '78.10,17.10,78.80,17.70';
      const fields = '{incidents{type,geometry{type,coordinates},properties{iconCategory,from,to,events{description}}}}';
      const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox}&fields=${encodeURIComponent(
        fields
      )}&language=en-GB&key=${TOMTOM_API_KEY}`;

      const res = await fetch(url);
      if (!res.ok) {
        setTomtomLive(false);
        return;
      }
      const data = await res.json();
      const incidents = data?.incidents ?? [];
      setTomtomLive(true);

      for (const incident of incidents) {
        const coords = incident?.geometry?.coordinates;
        const point = Array.isArray(coords?.[0]) ? coords[0] : coords;
        const lng = point?.[0];
        const lat = point?.[1];
        if (typeof lng !== 'number' || typeof lat !== 'number') continue;

        const streetName = incident?.properties?.from || incident?.properties?.to;
        const description = incident?.properties?.events?.[0]?.description || 'Traffic Advisory';
        const locationTitle = streetName ? `${streetName} (${description})` : description;

        await supabase.rpc('add_hazard', {
          p_location_name: `TomTom: ${locationTitle.slice(0, 45)}`,
          p_water_depth_level: 'MEDIUM',
          p_lng: lng,
          p_lat: lat,
        });
      }
    } catch {
      setTomtomLive(false);
    }
  };

  // 3. FETCH TSDPS GOVERNMENT RAINFALL ALERTS
  const loadGovtData = async () => {
    try {
      const tsdpsHazards = await fetchTsdpsRainfallHazards();
      for (const alert of tsdpsHazards) {
        await supabase.rpc('add_hazard', {
          p_location_name: alert.title,
          p_water_depth_level: alert.severity,
          p_lng: alert.coordinates[0],
          p_lat: alert.coordinates[1],
        });
      }
    } catch (e) {
      console.warn('TSDPS fetch skipped:', e);
    }
  };

  // TOGGLE MONSOON DOWNPOUR SIMULATION
  const toggleStormSimulation = async () => {
    if (isSimulationActive) {
      setIsSimulationActive(false);
      setIsRaining(false);
      setRainStatus('☀️ Clear Weather (0 mm/h)');
      await fetchHazards();
    } else {
      setIsSimulationActive(true);
      setIsRaining(true);
      setRainStatus('🌧️ STORM SIMULATION: 45 mm/h Downpour!');

      for (const spot of DEFAULT_STORM_HOTSPOTS) {
        try {
          await supabase.rpc('add_hazard', {
            p_location_name: spot.location_name,
            p_water_depth_level: spot.water_depth_level,
            p_lng: spot.lng,
            p_lat: spot.lat,
          });
        } catch (e) {
          console.warn('RPC simulation write skipped, using local fallback:', e);
        }
      }

      const { data } = await supabase.rpc('get_active_hazards');
      const combined = data && data.length > 0 ? (data as Hazard[]) : DEFAULT_STORM_HOTSPOTS;
      
      setActiveHazardsCount(combined.length);
      renderMarkers(combined);
      setLastUpdated(new Date());
    }
  };

  const fetchHazards = async () => {
    try {
      const { data, error } = await supabase.rpc('get_active_hazards');
      if (!error && data) {
        const points = isSimulationActive ? DEFAULT_STORM_HOTSPOTS : (data as Hazard[]);
        setActiveHazardsCount(points.length);
        renderMarkers(points);
        setLastUpdated(new Date());
      } else if (isSimulationActive) {
        setActiveHazardsCount(DEFAULT_STORM_HOTSPOTS.length);
        renderMarkers(DEFAULT_STORM_HOTSPOTS);
        setLastUpdated(new Date());
      }
    } catch {
      if (isSimulationActive) {
        setActiveHazardsCount(DEFAULT_STORM_HOTSPOTS.length);
        renderMarkers(DEFAULT_STORM_HOTSPOTS);
        setLastUpdated(new Date());
      }
    }
  };

  const renderMarkers = (points: Hazard[]) => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    points.forEach((point) => {
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      const color = point.water_depth_level === 'CRITICAL_IMPASSABLE' ? '#ef4444' : '#f59e0b';

      if (map.current) {
        const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
          `<div style="font-family:sans-serif; color:#111; padding: 8px; max-width:220px;">
            <strong style="font-size:13px; color:#b91c1c; display:block; margin-bottom:4px;">🚨 ${point.location_name}</strong>
            <span style="color:${color}; font-weight:bold; font-size:11px;">Status: ${point.water_depth_level}</span><br/>
            <small style="color:#555; display:block; margin-top:4px;">${point.description || 'Reported via MJ Fleet Watch'}</small><br/>
            <button id="btn-${point.id}" style="background:#ef4444; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold; width:100%;">
              🗑️ Resolve & Remove
            </button>
           </div>`
        );

        const marker = new maplibregl.Marker({ color })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map.current);

        popup.on('open', () => {
          setTimeout(() => {
            const btn = document.getElementById(`btn-${point.id}`);
            if (btn) {
              btn.onclick = async () => {
                await supabase.rpc('delete_hazard', { p_id: point.id });
                fetchHazards();
              };
            }
          }, 100);
        });

        markersRef.current.push(marker);
      }
    });
  };

  // ANIMATED RAIN CANVAS
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      height = canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const drops = Array.from({ length: 220 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      length: Math.random() * 22 + 10,
      speed: Math.random() * 12 + 16,
    }));

    const drawRain = () => {
      ctx.clearRect(0, 0, width, height);
      if (isRaining) {
        ctx.strokeStyle = 'rgba(186, 215, 255, 0.75)';
        ctx.lineWidth = 1.6;
        drops.forEach((drop) => {
          ctx.beginPath();
          ctx.moveTo(drop.x, drop.y);
          ctx.lineTo(drop.x - 2, drop.y + drop.length);
          ctx.stroke();
          drop.y += drop.speed;
          drop.x -= 0.5;
          if (drop.y > height) {
            drop.y = -drop.length;
            drop.x = Math.random() * width;
          }
        });
      }
      animationFrameId = requestAnimationFrame(drawRain);
    };
    drawRain();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isRaining]);

  // INITIALIZE MAP
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      center: [78.45, 17.41],
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {  
      map.current?.addSource('isro-bhuvan-flood-layer', {
        type: 'raster',
        tiles: [
          'https://bhuvan-vec1.nrsc.gov.in/bhuvan/gwc/service/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=flood:hyderabad_low_lying&STYLES=&FORMAT=image/png&TRANSPARENT=true&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&BBOX={bbox-epsg-3857}'
        ],
        tileSize: 256
      });
    
      map.current?.addLayer({
        id: 'bhuvan-flood-overlay',
        type: 'raster',
        source: 'isro-bhuvan-flood-layer',
        paint: {
          'raster-opacity': 0.5
        }
      });

      if (!map.current) return;
      fetchHazards();
    });

    // Prevent map click from opening "Report Modal" when clicking directly on a marker pin or popup
    map.current.on('click', (e) => {
      const target = e.originalEvent.target as HTMLElement;
      if (target.closest('.maplibregl-marker') || target.closest('.maplibregl-popup')) {
        return;
      }

      setReportCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      setReportName('');
      setReportOpen(true);
    });

    fetchLiveWeather();
    fetchTomTomHazards();
    loadGovtData();

    const interval = setInterval(() => {
      fetchLiveWeather();
      fetchTomTomHazards();
      loadGovtData();
      fetchHazards();
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const submitReport = async () => {
    if (!reportCoords || !reportName.trim()) return;
    const { error } = await supabase.rpc('add_hazard', {
      p_location_name: reportName.trim(),
      p_water_depth_level: severity,
      p_lng: reportCoords.lng,
      p_lat: reportCoords.lat,
    });
    if (!error) {
      setReportOpen(false);
      fetchHazards();
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', margin: 0, overflow: 'hidden' }}>
      
      {/* HEADER */}
      <header style={{ padding: '10px 16px', background: '#0f172a', color: '#fff', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', zIndex: 30 }}>
        <strong style={{ fontSize: '18px', color: '#38bdf8' }}>🚙 MJ Fleet Risk Intelligence</strong>

        <span style={{ fontSize: '11px', background: '#0284c7', color: '#fff', padding: '4px 10px', borderRadius: '12px', fontWeight: 'bold' }}>
          {rainStatus}
        </span>

        <span
          title={tomtomLive ? 'Live TomTom incident feed connected' : 'No TomTom key configured — demo mode'}
          style={{
            fontSize: '10px',
            background: tomtomLive ? '#16a34a' : '#78716c',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: '10px',
            fontWeight: 'bold',
          }}
        >
          {tomtomLive ? '● LIVE TRAFFIC FEED' : '○ DEMO MODE (no traffic key)'}
        </span>

        <button
          onClick={toggleStormSimulation}
          style={{
            background: isSimulationActive ? '#16a34a' : '#dc2626',
            color: '#fff',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          {isSimulationActive ? '🛑 Stop Storm Simulation' : '⚡ Simulate Monsoon Downpour'}
        </button>

        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: '4px', border: 'none', marginLeft: 'auto' }}
        >
          <option value="CRITICAL_IMPASSABLE">CRITICAL (Impassable Route)</option>
          <option value="MEDIUM">Medium Waterlogging</option>
        </select>
      </header>

      {/* TICKER */}
      <div style={{ background: '#1e293b', color: '#cbd5e1', padding: '5px 14px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', borderBottom: '1px solid #334155', zIndex: 30, overflow: 'hidden' }}>
        <span style={{ background: '#dc2626', color: '#fff', padding: '2px 6px', borderRadius: '3px', fontWeight: 'bold', fontSize: '10px', whiteSpace: 'nowrap' }}>
          FLEET ADVISORY FEED
        </span>
        <div style={{ overflow: 'hidden', flex: 1 }}>
          <div style={{ whiteSpace: 'nowrap', display: 'inline-block', animation: 'mj-ticker-scroll 30s linear infinite' }}>
            📢 {rainStatus} &nbsp;|&nbsp; 🚨 {activeHazardsCount} active route hazard{activeHazardsCount === 1 ? '' : 's'} being tracked &nbsp;|&nbsp;{' '}
            {tomtomLive ? '🛰️ Live TomTom traffic feed connected' : '🛰️ Traffic feed in demo mode — connect a TomTom key for live incidents'}{' '}
            &nbsp;|&nbsp; Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
          </div>
        </div>
        <style>{`
          @keyframes mj-ticker-scroll {
            0% { transform: translateX(100%); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      </div>

      {/* SIDEBAR & MAP */}
      <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
        
        {/* SIDEBAR */}
        <div
          style={{
            width: '300px',
            background: '#0f172a',
            color: '#f8fafc',
            zIndex: 20,
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '4px 0 12px rgba(0,0,0,0.3)',
            borderRight: '1px solid #334155',
            overflowY: 'auto',
          }}
        >
          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 'bold' }}>
              Active Route Hazards
            </span>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: activeHazardsCount > 0 ? '#ef4444' : '#22c55e', marginTop: '4px' }}>
              {activeHazardsCount} <span style={{ fontSize: '13px', color: '#cbd5e1', fontWeight: 'normal' }}>impacting cabs</span>
            </div>
          </div>

          <hr style={{ borderColor: '#334155', margin: 0 }} />

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 'bold' }}>
              Key Employee Corridors
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <div style={{ background: '#1e293b', padding: '8px 12px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Hitec City ➔ ORR</span>
                <span style={{ fontSize: '10px', background: isRaining ? '#ef4444' : '#22c55e', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                  {isRaining ? 'HIGH RISK' : 'CLEAR'}
                </span>
              </div>
              <div style={{ background: '#1e293b', padding: '8px 12px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Dilsukhnagar ➔ Lakdikapul</span>
                <span style={{ fontSize: '10px', background: activeHazardsCount > 0 ? '#ef4444' : '#22c55e', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                  {activeHazardsCount > 0 ? 'WATERLOGGED' : 'CLEAR'}
                </span>
              </div>
              <div style={{ background: '#1e293b', padding: '8px 12px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Gachibowli ➔ Airport</span>
                <span style={{ fontSize: '10px', background: '#22c55e', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                  CLEAR
                </span>
              </div>
            </div>
          </div>

          <hr style={{ borderColor: '#334155', margin: 0 }} />

          <div style={{ background: '#1e293b', padding: '12px', borderRadius: '8px', border: '1px solid #38bdf8' }}>
            <strong style={{ fontSize: '12px', color: '#38bdf8' }}>🔌 MoveInSync API Ready</strong>
            <p style={{ fontSize: '11px', color: '#94a3b8', margin: '4px 0 0 0', lineHeight: 1.4 }}>
              MJ exposes REST endpoints (`/get_active_hazards`) that can plug directly into MoveInSync routing engines to auto-avoid flooded cab routes.
            </p>
          </div>
        </div>

        {/* MAP & CANVAS */}
        <div style={{ flex: 1, position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
          <div ref={mapContainer} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }} />

          {/* REPORT HAZARD MODAL */}
          {reportOpen && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(15,23,42,0.55)',
                zIndex: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setReportOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#0f172a',
                  color: '#f8fafc',
                  padding: '20px',
                  borderRadius: '10px',
                  width: '300px',
                  border: '1px solid #334155',
                }}
              >
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#38bdf8' }}>Report Waterlog / Hazard</h3>
                <input
                  autoFocus
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  placeholder="e.g. Waterlog near flyover"
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #334155',
                    marginBottom: '12px',
                    background: '#1e293b',
                    color: '#fff',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setReportOpen(false)}
                    style={{
                      background: '#334155',
                      color: '#fff',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitReport}
                    disabled={!reportName.trim()}
                    style={{
                      background: reportName.trim() ? '#dc2626' : '#7f1d1d',
                      color: '#fff',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: reportName.trim() ? 'pointer' : 'not-allowed',
                      fontSize: '12px',
                      fontWeight: 'bold',
                    }}
                  >
                    Report
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}