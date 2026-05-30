import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import { Container, Spinner, Alert } from "react-bootstrap";
import "leaflet/dist/leaflet.css";

import { createMarkerAvatar } from "./MarkerAvatar";
import MapClickHandler from "./MapClickHandler";
import { EventModal } from "./EventModal";
import "./mapview.css";

// Fallback por defecto: Madrid
const MADRID = [40.4168, -3.7038];

// Distancia haversine en km entre dos [lat, lng]
const haversine = (a, b) => {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Prioridad del centro: GPS del usuario > evento mas cercano a Madrid > Madrid
const computeCenter = (center, events) => {
  if (center) return center;

  if (events && events.length > 0) {
    const sorted = [...events]
      .filter((e) => Array.isArray(e.position))
      .sort(
        (a, b) =>
          haversine(MADRID, a.position) - haversine(MADRID, b.position)
      );
    if (sorted.length > 0) return sorted[0].position;
  }

  return MADRID;
};

/**
 * Mapview: vista de mapa autosuficiente. Asume todas las responsabilidades
 * que antes vivian en pages/Map.jsx:
 *   - fetch de /api/events
 *   - geolocalizacion del usuario
 *   - estado de loading / error
 *   - apertura del EventModal (crear al clicar mapa vacio, ver/editar al
 *     clicar un marker existente)
 *
 * Props opcionales para que el padre reaccione (no son obligatorias):
 *   onMapClick(coords)     -> se dispara despues de abrir el modal de creacion
 *   onMarkerClick(event)   -> se dispara despues de abrir el modal de un evento
 *   onSaved(eventOrNull)   -> se dispara tras un guardado del EventModal
 */
export const Mapview = ({ onMapClick, onMarkerClick, onSaved }) => {
  // ── datos ──────────────────────────────────────────
  const [events, setEvents]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [userCenter, setUserCenter] = useState(null);

  // ── modal interno ─────────────────────────────────
  const [modalOpen, setModalOpen]         = useState(false);
  const [activeEventId, setActiveEventId] = useState(null); // null => crear
  const [prefillCoords, setPrefillCoords] = useState(null);

  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  // ── fetch events ──────────────────────────────────
  const fetchEvents = async () => {
    try {
      setLoading(true);
      setError(null);

      const apiUrl = import.meta.env.VITE_BACKEND_URL;
      const token  = localStorage.getItem("token");

      if (!apiUrl) throw new Error("Falta VITE_BACKEND_URL en el .env del frontend");

      const res = await fetch(`${apiUrl}/api/events`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch events");

      const data = await res.json();
      const normalized = data
        .filter((e) => e.latitude != null && e.longitude != null)
        .map((e) => ({ ...e, position: [e.latitude, e.longitude] }));

      setEvents(normalized);
    } catch (err) {
      setError(err.message);
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserCenter([pos.coords.latitude, pos.coords.longitude]),
        () => {
          /* permiso denegado o no disponible: usamos fallback */
        },
        { timeout: 5000 }
      );
    }
  }, []);

  const mapCenter = useMemo(
    () => computeCenter(userCenter, events),
    [userCenter, events]
  );

  // ── handlers ──────────────────────────────────────
  const handleMapClick = (coords) => {
    setActiveEventId(null);
    setPrefillCoords(coords);
    setModalOpen(true);
    onMapClick && onMapClick(coords);
  };

  const handleMarkerClick = (event) => {
    setActiveEventId(event.id);
    setPrefillCoords(null);
    setModalOpen(true);
    onMarkerClick && onMarkerClick(event);
  };

  const handleClose = () => {
    setModalOpen(false);
    setActiveEventId(null);
    setPrefillCoords(null);
  };

  const handleSaved = (eventOrNull) => {
    fetchEvents();
    onSaved && onSaved(eventOrNull);
  };

  // ── render ────────────────────────────────────────
  return (
    <Container fluid className="map-page p-0">
      {loading && (
        <div className="text-center py-3">
          <Spinner animation="border" size="sm" />
        </div>
      )}

      {error && (
        <Alert variant="danger" className="m-3">
          {error}
        </Alert>
      )}

      <div
        className="sq-map-wrapper"
        style={{ height: "calc(100vh - 56px - 64px)", width: "100%" }}
      >
        <MapContainer
          center={mapCenter}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />

          <MapClickHandler onMapClick={handleMapClick} />

          {events.map((event) => (
            <Marker
              key={event.id}
              position={event.position}
              icon={createMarkerAvatar(event.image)}
              eventHandlers={{
                click: () => handleMarkerClick(event),
              }}
            />
          ))}
        </MapContainer>
      </div>

      <EventModal
        show={modalOpen}
        onHide={handleClose}
        eventId={activeEventId}
        prefillCoords={prefillCoords}
        currentUser={currentUser}
        onSaved={handleSaved}
      />
    </Container>
  );
};

export default Mapview;