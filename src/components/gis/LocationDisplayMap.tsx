import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { defaultIcon } from "./leafletIcon";

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface Props {
  latitude: number;
  longitude: number;
  label?: string;
}

export default function LocationDisplayMap({ latitude, longitude, label }: Props) {
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border border-slate-200">
        <MapContainer
          center={[latitude, longitude]}
          zoom={16}
          style={{ height: 200, width: "100%" }}
          dragging={false}
          zoomControl={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          keyboard={false}
          attributionControl
        >
          <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
          <Marker position={[latitude, longitude]} icon={defaultIcon}>
            {label && <Popup>{label}</Popup>}
          </Marker>
        </MapContainer>
      </div>
      <div className="font-noto-ethiopic text-xs text-slate-600">
        ኬክሮስ: <span className="font-mono">{latitude.toFixed(6)}</span>,{" "}
        ኬንትሮስ: <span className="font-mono">{longitude.toFixed(6)}</span>
      </div>
    </div>
  );
}
