import { useEffect, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LeafletMouseEvent, Marker as LeafletMarker } from "leaflet";
import { toast } from "sonner";
import { LocateFixed } from "lucide-react";
import { defaultIcon } from "./leafletIcon";

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface Props {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  defaultCenter?: [number, number];
}

const round6 = (n: number) => Number(n.toFixed(6));

function ClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onChange(round6(e.latlng.lat), round6(e.latlng.lng));
    },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) {
      map.setView([lat, lng], Math.max(map.getZoom(), 15));
    }
  }, [lat, lng, map]);
  return null;
}

function LocateButton({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  const map = useMap();
  const handleClick = () => {
    if (!navigator.geolocation) {
      toast.error("የአካባቢ አገልግሎት አይገኝም / Geolocation not available");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = round6(pos.coords.latitude);
        const lng = round6(pos.coords.longitude);
        onChange(lat, lng);
        map.setView([lat, lng], 17);
      },
      () => {
        toast.error("የአካባቢ ፈቃድ አልተሰጠም / Location permission not granted");
      },
    );
  };
  return (
    <div className="leaflet-top leaflet-right">
      <div className="leaflet-control leaflet-bar !m-2">
        <button
          type="button"
          onClick={handleClick}
          className="font-noto-ethiopic flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow hover:bg-slate-50"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          የአሁኑን አካባቢ ተጠቀም
          <span className="text-slate-400">/ Use Current</span>
        </button>
      </div>
    </div>
  );
}

export default function LocationPickerMap({
  latitude,
  longitude,
  onChange,
  defaultCenter = [9.314, 42.1272],
}: Props) {
  const markerRef = useRef<LeafletMarker | null>(null);
  const hasCoord = latitude != null && longitude != null;
  const center: [number, number] = hasCoord ? [latitude, longitude] : defaultCenter;

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border border-slate-200">
        <MapContainer center={center} zoom={hasCoord ? 16 : 14} style={{ height: 320, width: "100%" }}>
          <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
          <ClickHandler onChange={onChange} />
          <Recenter lat={latitude} lng={longitude} />
          <LocateButton onChange={onChange} />
          {hasCoord && (
            <Marker
              position={[latitude, longitude]}
              icon={defaultIcon}
              draggable
              ref={(m) => {
                markerRef.current = m;
              }}
              eventHandlers={{
                dragend: () => {
                  const m = markerRef.current;
                  if (!m) return;
                  const { lat, lng } = m.getLatLng();
                  onChange(round6(lat), round6(lng));
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <div className="font-noto-ethiopic text-xs text-slate-600">
        {hasCoord ? (
          <>
            ኬክሮስ / Latitude: <span className="font-mono">{latitude.toFixed(6)}</span>
            <span className="mx-2 text-slate-300">•</span>
            ኬንትሮስ / Longitude: <span className="font-mono">{longitude.toFixed(6)}</span>
          </>
        ) : (
          <span className="text-slate-500">አልተመረጠም / Not selected</span>
        )}
      </div>
    </div>
  );
}
