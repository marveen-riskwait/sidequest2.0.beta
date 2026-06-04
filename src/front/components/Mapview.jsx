import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import { useSearchParams } from "react-router-dom";
import { Container, Spinner, Alert } from "react-bootstrap";
import { FiCrosshair } from "react-icons/fi";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import useGlobalReducer from "../hooks/useGlobalReducer";
import { createMarkerAvatar, pickMarkerImage, pickMarkerLetter } from "./MarkerAvatar";
import MapClickHandler from "./MapClickHandler";
import { EventModal } from "./EventModal";
import "./mapview.css";

const MADRID = [40.4168, -3.7038];
const computeCenter = (userCenter) => userCenter || MADRID;

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysUntilEvent = (event) => {
  if (!event?.date) return null;
  const evDate = new Date(event.date);
  if (Number.isNaN(evDate.getTime())) return null;
  const today = startOfDay(new Date());
  const ev = startOfDay(evDate);
  return Math.round((ev.getTime() - today.getTime()) / 86400000);
};

const formatDaysUntil = (n) => {
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} ago`;
  return `in ${n} day${n === 1 ? "" : "s"}`;
};

const formatTooltip = (event) => {
  const title = event.title || "Event";
  const when = formatDaysUntil(daysUntilEvent(event));
  const time = event.time || "";
  return [title, when, time].filter(Boolean).join(" · ");
};

// Blue "you are here" dot with a soft pulsing ring.
const createUserDotIcon = () =>
  L.divIcon({
    html:
      `<div style="position:relative;width:22px;height:22px;">` +
        `<div style="position:absolute;inset:-12px;border-radius:50%;` +
          `background:rgba(66,133,244,0.18);` +
          `animation:sq-user-pulse 2s ease-out infinite;` +
          `pointer-events:none;"></div>` +
        `<div style="position:absolute;top:50%;left:50%;` +
          `transform:translate(-50%,-50%);` +
          `width:16px;height:16px;` +
          `background:#4285f4;` +
          `border:3px solid #fff;border-radius:50%;` +
          `box-shadow:0 2px 6px rgba(0,0,0,0.45);` +
          `"></div>` +
      `</div>`,
    className: "sq-user-dot-icon",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

// Manual-interaction detector. Lives inside MapContainer (react-leaflet
// requires that for useMapEvents). Detects user drags and manual zooms,
// filtering out programmatic moves via the isProgRef flag.
const UserInteractionWatcher = ({ isProgRef, onUserInteract }) => {
  useMapEvents({
    dragstart: () => {
      onUserInteract();
    },
    zoomstart: () => {
      if (!isProgRef.current) onUserInteract();
    },
  });
  return null;
};

export const Mapview = ({ onMapClick, onMarkerClick, onSaved }) => {
  const { store } = useGlobalReducer();
  const mapFilterDays = store?.mapFilterDays ?? null;

  const [events, setEvents]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [userCenter, setUserCenter] = useState(null);

  const [modalOpen, setModalOpen]         = useState(false);
  const [activeEventId, setActiveEventId] = useState(null);
  const [prefillCoords, setPrefillCoords] = useState(null);

  const mapRef = useRef(null);

  const [followUser, setFollowUserState] = useState(true);
  const followUserRef = useRef(true);
  const setFollowUser = (v) => {
    followUserRef.current = v;
    setFollowUserState(v);
  };

  const isProgrammaticMoveRef = useRef(false);
  const hasAutoCenteredRef = useRef(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const pendingFocusIdRef = useRef(null);
  const [forceShowEventId, setForceShowEventId] = useState(null);

  useEffect(() => {
    const raw = searchParams.get("event");
    if (!raw) return;
    const id = parseInt(raw, 10);
    if (!Number.isNaN(id)) pendingFocusIdRef.current = id;
  }, [searchParams]);

  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  const fetchEvents = async () => {
    const apiUrl = import.meta.env.VITE_BACKEND_URL;
    const token  = localStorage.getItem("token");
    if (!apiUrl) {
      setError("VITE_BACKEND_URL is missing from the frontend .env");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    let delay = 400;
    for (;;) {
      try {
        const res = await fetch(`${apiUrl}/api/events`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          setError(`Failed to fetch events (${res.status})`);
          setLoading(false);
          return;
        }
        const data = await res.json();
        const normalized = data
          .filter((e) => e.latitude != null && e.longitude != null)
          .map((e) => ({ ...e, position: [e.latitude, e.longitude] }));
        setEvents(normalized);
        setLoading(false);
        return;
      } catch (_) {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 4000);
      }
    }
  };

  // geolocation: watchPosition + one-time auto-center on first fix
  useEffect(() => {
    fetchEvents();

    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = [pos.coords.latitude, pos.coords.longitude];
        setUserCenter(next);

        if (!hasAutoCenteredRef.current && mapRef.current) {
          isProgrammaticMoveRef.current = true;
          mapRef.current.flyTo(next, 14, { duration: 0.8 });
          hasAutoCenteredRef.current = true;
          setTimeout(() => { isProgrammaticMoveRef.current = false; }, 900);
        }
      },
      () => { /* permission denied / unavailable -> fallback Madrid */ },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // deep-link focus: when ?event=<id> is set, fly to that event
  useEffect(() => {
    const targetId = pendingFocusIdRef.current;
    if (!targetId || events.length === 0 || !mapRef.current) return;

    const target = events.find((e) => e.id === targetId);
    if (!target || target.latitude == null || target.longitude == null) {
      pendingFocusIdRef.current = null;
      if (searchParams.get("event")) {
        searchParams.delete("event");
        setSearchParams(searchParams, { replace: true });
      }
      return;
    }

    setFollowUser(false);
    isProgrammaticMoveRef.current = true;
    mapRef.current.flyTo([target.latitude, target.longitude], 15, { duration: 1 });
    setTimeout(() => { isProgrammaticMoveRef.current = false; }, 1100);

    setForceShowEventId(targetId);

    pendingFocusIdRef.current = null;
    if (searchParams.get("event")) {
      searchParams.delete("event");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // follow effect: pan to the user on each GPS update (follow ON only)
  useEffect(() => {
    if (!followUser || !userCenter || !mapRef.current) return;
    if (!hasAutoCenteredRef.current) return;
    mapRef.current.panTo(userCenter, { animate: true, duration: 0.5 });
  }, [userCenter, followUser]);

  const mapCenter = useMemo(() => computeCenter(userCenter), [userCenter]);

  const visibleEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.id === forceShowEventId) return true;
      if (e.my_status === "pending") return false;
      const days = daysUntilEvent(e);
      if (days === null) return true;
      if (days < 0) return false;
      if (mapFilterDays !== null && days > mapFilterDays) return false;
      return true;
    });
  }, [events, mapFilterDays, forceShowEventId]);

  const handleUserInteract = () => {
    if (followUserRef.current) setFollowUser(false);
  };

  const recenterOnUser = () => {
    if (!mapRef.current || !userCenter) return;
    isProgrammaticMoveRef.current = true;
    setFollowUser(true);
    mapRef.current.flyTo(userCenter, 15, { duration: 0.8 });
    setTimeout(() => { isProgrammaticMoveRef.current = false; }, 900);
  };

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

  return (
    <Container fluid className="map-page p-0">
      {loading && (
        <div className="text-center py-3">
          <Spinner animation="border" size="sm" />
        </div>
      )}

      {error && (
        <Alert variant="danger" className="m-3">{error}</Alert>
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
          ref={mapRef}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />

          <MapClickHandler onMapClick={handleMapClick} />

          <UserInteractionWatcher
            isProgRef={isProgrammaticMoveRef}
            onUserInteract={handleUserInteract}
          />

          {userCenter && (
            <Marker
              position={userCenter}
              icon={createUserDotIcon()}
              interactive={false}
              keyboard={false}
            />
          )}

          {visibleEvents.map((event) => (
            <Marker
              key={event.id}
              position={event.position}
              icon={createMarkerAvatar(
                pickMarkerImage(event),
                56,
                event.going_count || 0,
                formatTooltip(event),
                pickMarkerLetter(event)
              )}
              eventHandlers={{ click: () => handleMarkerClick(event) }}
            />
          ))}
        </MapContainer>

        <button
          type="button"
          className={`sq-recenter-btn ${followUser ? "is-on" : "is-off"}`}
          onClick={recenterOnUser}
          disabled={!userCenter}
          title={
            !userCenter
              ? "Waiting for GPS..."
              : followUser
              ? "Following you · Click to recenter"
              : "Follow me again"
          }
        >
          <FiCrosshair size={20} />
        </button>
      </div>

      <EventModal
        show={modalOpen}
        onHide={handleClose}
        eventId={activeEventId}
        prefillCoords={prefillCoords}
        currentUser={currentUser}
        onSaved={handleSaved}
        onDeleted={() => fetchEvents()}
      />
    </Container>
  );
};

export default Mapview;
