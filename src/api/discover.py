"""
Tanda 7X — Discover: eventos del mundo real (proveedores externos).

Blueprint propio (registrado desde routes.py vía record_once — app.py no
se toca) que actúa de PROXY + NORMALIZADOR:

  - Las API keys viven AQUÍ (variables de entorno), jamás en el frontend.
  - Cada proveedor es un adaptador que traduce su formato al ESQUEMA
    COMÚN de SideQuest. Añadir un proveedor nuevo = una función _fetch_*
    + una entrada en PROVIDERS. El frontend no cambia.
  - Caché en memoria (TTL 10 min) por combinación de filtros: cien
    usuarios buscando "Madrid este finde" = una sola llamada externa.

Esquema común que devuelve GET /api/discover/events:

    {
      "id":          "tm_Z698xZC2Z17a3qZ",   # prefijo del proveedor
      "source":      "ticketmaster",
      "title":       "...",
      "description": "...",                  # resumen si existe
      "date":        "2026-07-04",           # YYYY-MM-DD (formato Event)
      "time":        "20:30",                # HH:MM o null
      "venue_name":  "WiZink Center",
      "location":    "Av. Felipe II s/n, Madrid, ES",
      "latitude":    40.424,                 # null si el proveedor no lo da
      "longitude":   -3.672,
      "price_min":   35.0,                   # null si desconocido
      "price_max":   120.0,
      "currency":    "EUR",
      "category":    "Music",
      "url":         "https://...",          # entradas / página oficial
      "image":       "https://...",
    }

Proveedor activo: Ticketmaster Discovery (gratuita, 5000 req/día).
Requiere en el .env / Render:  TICKETMASTER_API_KEY=<Consumer Key>
Próximos candidatos (misma estructura): TheSportsDB, Nager.Date,
OpenAgenda, Bandsintown.
"""
import datetime as dt
import os
import time

import requests
from flask import Blueprint, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import jwt_required

discover_bp = Blueprint("discover", __name__)

# CORS — flask-cors NO se hereda entre blueprints: el CORS(api, ...) de
# routes.py no cubre este blueprint y en dev (front :3000 / API :3001)
# el preflight fallaba. ESPEJO de la lista de routes.py — si cambias
# una, cambia la otra.
CORS(
    discover_bp,
    supports_credentials=True,
    origins=[
        r"https://.*\.app\.github\.dev",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost:3000",
    ],
)

# ── Caché en memoria ─────────────────────────────────────────
# Suficiente para un solo proceso (gunicorn -w 1, ver Procfile). Si
# algún día hay varios workers, migrar a Redis es trivial.
CACHE_TTL = 600  # 10 min
_cache = {}


def _cache_get(key):
    hit = _cache.get(key)
    if not hit:
        return None
    expires, value = hit
    if time.time() > expires:
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key, value):
    # Poda perezosa para que el dict no crezca sin límite.
    if len(_cache) > 256:
        now = time.time()
        for k in [k for k, (exp, _) in _cache.items() if exp < now]:
            _cache.pop(k, None)
    _cache[key] = (time.time() + CACHE_TTL, value)


# ── Adaptador: Ticketmaster Discovery ────────────────────────
TM_BASE = "https://app.ticketmaster.com/discovery/v2/events.json"

# Categorías del frontend → segmentos de Ticketmaster.
TM_CATEGORIES = {
    "music":  "Music",
    "sports": "Sports",
    "arts":   "Arts & Theatre",
    "film":   "Film",
    "misc":   "Miscellaneous",
}


def _tm_pick_image(ev):
    """La imagen 16:9 más grande disponible (las cards las quieren así)."""
    images = ev.get("images") or []
    best = None
    for img in images:
        if img.get("ratio") == "16_9":
            if not best or (img.get("width") or 0) > (best.get("width") or 0):
                best = img
    if not best and images:
        best = images[0]
    return best.get("url") if best else None


def _join_address(parts):
    """Une partes de dirección SIN duplicados — los venues a veces meten
    la ciudad/país dentro de line1 ("28022 Madrid, Spain") y el resultado
    "28022 Madrid, Spain, Madrid, ES" confunde a los geocoders del
    frontend (Nominatim lo mandaba al mar)."""
    out = []
    for p in parts:
        if not p:
            continue
        p = p.strip()
        # ya contenida en algo anterior → sobra
        if any(p.lower() in q.lower() for q in out):
            continue
        # algo anterior está contenido en esta → la nueva lo sustituye
        out = [q for q in out if q.lower() not in p.lower()]
        out.append(p)
    return ", ".join(out)


def _tm_summary(ev, venue):
    """Resumen sintetizado cuando Ticketmaster no trae descripción:
    género · lineup · venue — mucho más contexto que una card vacía."""
    classifications = (ev.get("classifications") or [{}])[0]
    chain = " · ".join(
        c.get("name")
        for c in (
            classifications.get("segment"),
            classifications.get("genre"),
            classifications.get("subGenre"),
        )
        if c and c.get("name") and c.get("name") != "Undefined"
    )
    attractions = (ev.get("_embedded") or {}).get("attractions") or []
    lineup = ", ".join(a.get("name") for a in attractions if a.get("name"))

    parts = []
    if chain:
        parts.append(chain)
    if lineup:
        parts.append("Lineup: {}".format(lineup))
    vline = ", ".join(p for p in (
        venue.get("name"), (venue.get("city") or {}).get("name")) if p)
    if vline:
        parts.append("Venue: {}".format(vline))
    return "\n".join(parts) or None


def _tm_normalize(ev):
    venues = (ev.get("_embedded") or {}).get("venues") or [{}]
    venue = venues[0]
    loc = venue.get("location") or {}

    address = _join_address([
        (venue.get("address") or {}).get("line1"),
        (venue.get("city") or {}).get("name"),
        (venue.get("country") or {}).get("countryCode"),
    ])

    dates = (ev.get("dates") or {}).get("start") or {}
    time_s = (dates.get("localTime") or "")[:5] or None

    prices = (ev.get("priceRanges") or [{}])[0]

    classifications = (ev.get("classifications") or [{}])[0]
    category = ((classifications.get("segment") or {}).get("name")) or None

    # Descripción con contexto: la real si existe; si no, el resumen
    # sintetizado (género/lineup/venue). pleaseNote (logística) se
    # añade detrás solo cuando aporta algo distinto.
    description = ev.get("info") or ev.get("description") or _tm_summary(ev, venue)
    please_note = ev.get("pleaseNote")
    if please_note and please_note != description:
        description = (
            "{}\n\nNote: {}".format(description, please_note)
            if description else "Note: {}".format(please_note)
        )

    try:
        lat = float(loc["latitude"])
        lng = float(loc["longitude"])
    except (KeyError, TypeError, ValueError):
        lat = lng = None

    return {
        "id":          "tm_{}".format(ev.get("id")),
        "source":      "ticketmaster",
        "title":       ev.get("name"),
        "description": description,
        "date":        dates.get("localDate"),
        "time":        time_s,
        "venue_name":  venue.get("name"),
        "location":    address or venue.get("name") or "",
        "latitude":    lat,
        "longitude":   lng,
        "price_min":   prices.get("min"),
        "price_max":   prices.get("max"),
        "currency":    prices.get("currency"),
        "category":    category,
        "url":         ev.get("url"),
        "image":       _tm_pick_image(ev),
    }


def _fetch_ticketmaster(filters):
    """Devuelve (events, total). Lanza en error de red/API — el caller
    decide la respuesta HTTP."""
    params = {
        "apikey": os.getenv("TICKETMASTER_API_KEY"),
        "size":   filters["size"],
        "page":   filters["page"],
        "sort":   "date,asc",
    }
    if filters.get("q"):
        params["keyword"] = filters["q"]
    if filters.get("city"):
        params["city"] = filters["city"]
    elif filters.get("lat") is not None and filters.get("lng") is not None:
        params["latlong"] = "{},{}".format(filters["lat"], filters["lng"])
        params["radius"] = filters.get("radius") or 40
        params["unit"] = "km"
    if filters.get("start"):
        params["startDateTime"] = "{}T00:00:00Z".format(filters["start"])
    if filters.get("end"):
        params["endDateTime"] = "{}T23:59:59Z".format(filters["end"])
    if filters.get("category") in TM_CATEGORIES:
        params["classificationName"] = TM_CATEGORIES[filters["category"]]

    r = requests.get(TM_BASE, params=params, timeout=8)
    r.raise_for_status()
    data = r.json()

    raw = (data.get("_embedded") or {}).get("events") or []
    total = (data.get("page") or {}).get("totalElements") or len(raw)
    return [_tm_normalize(e) for e in raw], total


# ── Adaptador: Nager.Date (festivos oficiales — gratis, sin key) ────
# Aporta contexto de viaje: "ese día es fiesta nacional allí". Necesita
# el país (el frontend lo resuelve geocodificando la búsqueda).
NAGER_BASE = "https://date.nager.at/api/v3/PublicHolidays"


def _fetch_nager(filters):
    country = (filters.get("country") or "").upper()
    # Sin país no hay festivos; y solo en la página 0 (no se paginan —
    # repetirlos en cada "Load more" duplicaría las cards).
    if not country or filters["page"] > 0:
        return [], 0
    if filters.get("category") not in (None, "misc"):
        return [], 0

    today = dt.date.today()
    start = filters.get("start") or today.isoformat()
    end = filters.get("end") or (today + dt.timedelta(days=60)).isoformat()

    events = []
    for year in sorted({int(start[:4]), int(end[:4])}):
        r = requests.get("{}/{}/{}".format(NAGER_BASE, year, country), timeout=8)
        r.raise_for_status()
        for h in r.json() or []:
            d = h.get("date")
            if not d or d < start or d > end:
                continue
            title = h.get("localName") or h.get("name")
            if filters.get("q") and filters["q"].lower() not in (title or "").lower():
                continue
            events.append({
                "id":          "ng_{}_{}".format(country, d),
                "source":      "nager",
                "title":       title,
                "description": "Public holiday in {} ({}).".format(
                    country, h.get("name")),
                "date":        d,
                "time":        None,
                "venue_name":  None,
                "location":    country,
                "latitude":    None,
                "longitude":   None,
                "price_min":   None,
                "price_max":   None,
                "currency":    None,
                "category":    "Holiday",
                "url":         None,
                "image":       None,
            })
    return events, len(events)


# ── Adaptador: Calendarific (festivos extendidos — key gratuita) ────
# Redundante con Nager para festivos nacionales (el endpoint deduplica
# por título+fecha); aporta festivos locales/religiosos. Se activa solo
# con CALENDARIFIC_API_KEY en el entorno.
CALENDARIFIC_BASE = "https://calendarific.com/api/v2/holidays"


def _fetch_calendarific(filters):
    country = (filters.get("country") or "").upper()
    if not country or filters["page"] > 0:
        return [], 0
    if filters.get("category") not in (None, "misc"):
        return [], 0

    today = dt.date.today()
    start = filters.get("start") or today.isoformat()
    end = filters.get("end") or (today + dt.timedelta(days=60)).isoformat()

    events = []
    for year in sorted({int(start[:4]), int(end[:4])}):
        r = requests.get(CALENDARIFIC_BASE, params={
            "api_key": os.getenv("CALENDARIFIC_API_KEY"),
            "country": country,
            "year": year,
        }, timeout=8)
        r.raise_for_status()
        holidays = (((r.json() or {}).get("response")) or {}).get("holidays") or []
        for h in holidays:
            d = ((h.get("date") or {}).get("iso") or "")[:10]
            if not d or d < start or d > end:
                continue
            title = h.get("name")
            if filters.get("q") and filters["q"].lower() not in (title or "").lower():
                continue
            events.append({
                "id":          "cal_{}_{}_{}".format(country, d, abs(hash(title)) % 10**8),
                "source":      "calendarific",
                "title":       title,
                "description": h.get("description"),
                "date":        d,
                "time":        None,
                "venue_name":  None,
                "location":    country,
                "latitude":    None,
                "longitude":   None,
                "price_min":   None,
                "price_max":   None,
                "currency":    None,
                "category":    "Holiday",
                "url":         None,
                "image":       None,
            })
    return events, len(events)


# ── Adaptador: PredictHQ (agregador global — token de trial/pago) ──
# Se activa solo con PREDICTHQ_TOKEN. Trabaja por coordenadas (el
# frontend ya las manda también en modo ciudad, geocodificadas).
PHQ_BASE = "https://api.predicthq.com/v1/events/"

PHQ_CATEGORIES = {
    "music":  "concerts,festivals",
    "sports": "sports",
    "arts":   "performing-arts,expos",
    "film":   "performing-arts",
    "misc":   "community,conferences,expos",
}


def _fetch_predicthq(filters):
    if filters.get("lat") is None or filters.get("lng") is None:
        return [], 0

    params = {
        "limit":  filters["size"],
        "offset": filters["page"] * filters["size"],
        "sort":   "start",
        "within": "{}km@{},{}".format(
            filters.get("radius") or 40, filters["lat"], filters["lng"]),
    }
    if filters.get("q"):
        params["q"] = filters["q"]
    if filters.get("start"):
        params["active.gte"] = filters["start"]
    if filters.get("end"):
        params["active.lte"] = filters["end"]
    if filters.get("category") in PHQ_CATEGORIES:
        params["category"] = PHQ_CATEGORIES[filters["category"]]

    r = requests.get(PHQ_BASE, params=params, timeout=8, headers={
        "Authorization": "Bearer {}".format(os.getenv("PREDICTHQ_TOKEN")),
        "Accept": "application/json",
    })
    r.raise_for_status()
    data = r.json() or {}

    events = []
    for ev in data.get("results") or []:
        start = ev.get("start") or ""
        location = ev.get("location") or [None, None]  # [lng, lat]
        venue = next(
            (e for e in (ev.get("entities") or []) if e.get("type") == "venue"),
            {},
        )
        time_s = start[11:16] if len(start) >= 16 else None
        events.append({
            "id":          "phq_{}".format(ev.get("id")),
            "source":      "predicthq",
            "title":       ev.get("title"),
            "description": ev.get("description") or ", ".join(ev.get("labels") or []) or None,
            "date":        start[:10] or None,
            "time":        None if time_s == "00:00" else time_s,
            "venue_name":  venue.get("name"),
            "location":    venue.get("formatted_address") or "",
            "latitude":    location[1],
            "longitude":   location[0],
            "price_min":   None,
            "price_max":   None,
            "currency":    None,
            "category":    (ev.get("category") or "").replace("-", " ").title() or None,
            "url":         None,
            "image":       None,
        })
    return events, data.get("count") or len(events)


# ── Adaptador: HasData Google Events (cobertura de cola larga) ──────
# Google Events agrega lo que ninguna API directa tiene: eventos de
# Facebook públicos, salas, ayuntamientos, Meetup, RA/Dice/Fever cuando
# Google los indexa. Es la capa de MAYOR cobertura. Se activa con
# HASDATA_API_KEY.
#
# Particularidades que el normalizador absorbe:
#   - Fechas TEXTUALES sin año ("Sat, Jul 4, 8 – 11 PM") → _parse_google_date
#     deduce año (futuro) y hora; si no puede, deja la fecha vacía
#     (editable en el modal).
#   - SIN lat/lng → las cards no harán flyTo, pero al crear el quest el
#     EventModal geocodifica la dirección igual que un evento manual.
#   - Dirección con el venue mezclado → se separa (mismo criterio v18).
#   - Es TEXTUAL: necesita un nombre de sitio (`place`); en near-me el
#     frontend lo resuelve por reverse-geocoding.
HASDATA_GEVENTS_URL = "https://api.hasdata.com/scrape/google/events"

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug",
     "sep", "oct", "nov", "dec"], 1)}

# query word por categoría (Google Events filtra por texto, no por enum)
HASDATA_CATEGORY_Q = {
    "music":  "concerts",
    "sports": "sports events",
    "arts":   "theatre",
    "film":   "film screenings",
    "misc":   "events",
}


def _parse_google_date(date_obj):
    """('YYYY-MM-DD'|None, 'HH:MM'|None) desde el bloque de fecha textual
    de Google Events. Asume año actual; si la fecha caería >30 días en el
    pasado, rueda al año siguiente (los eventos miran al futuro)."""
    import re
    if not date_obj:
        return None, None
    if isinstance(date_obj, dict):
        start = (date_obj.get("startDate") or date_obj.get("start_date") or "")
        when = (date_obj.get("when") or "")
    else:
        start = when = str(date_obj)
    text = "{} {}".format(start, when)

    date_iso = None
    m = re.search(
        r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})",
        text, re.I)
    if m:
        month = _MONTHS[m.group(1).lower()[:3]]
        day = int(m.group(2))
        today = dt.date.today()
        try:
            cand = dt.date(today.year, month, day)
            if cand < today - dt.timedelta(days=30):
                cand = dt.date(today.year + 1, month, day)
            date_iso = cand.isoformat()
        except ValueError:
            date_iso = None

    time_hhmm = None
    tm = re.search(r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?", when, re.I)
    if tm:
        hour = int(tm.group(1))
        minute = int(tm.group(2) or 0)
        if tm.group(3).lower() == "p" and hour != 12:
            hour += 12
        if tm.group(3).lower() == "a" and hour == 12:
            hour = 0
        time_hhmm = "{:02d}:{:02d}".format(hour, minute)
    else:
        tm24 = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", when)
        if tm24:
            time_hhmm = "{:02d}:{:02d}".format(
                int(tm24.group(1)), int(tm24.group(2)))
    return date_iso, time_hhmm


def _hd_get(d, *keys):
    """Primer valor no-nulo entre varias claves — HasData mezcla
    camelCase y snake_case según el endpoint."""
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return None


def _hd_normalize(ev):
    venue = _hd_get(ev, "venue") or {}
    venue_name = venue.get("name") if isinstance(venue, dict) else None

    address = _hd_get(ev, "address") or []
    if isinstance(address, str):
        address = [address]
    # Quita el venue del primer segmento para no romper el geocoder.
    loc_parts = list(address)
    if venue_name and loc_parts and venue_name.lower() in (loc_parts[0] or "").lower():
        loc_parts[0] = (loc_parts[0].replace(venue_name, "").strip(" ,")) or None
    location = _join_address(loc_parts)

    date_iso, time_hhmm = _parse_google_date(_hd_get(ev, "date"))

    return {
        "id":          "hd_{}".format(abs(hash(
            (ev.get("title"), str(_hd_get(ev, "date")), _hd_get(ev, "link"))
        )) % 10**12),
        "source":      "google",
        "title":       ev.get("title"),
        "description": _hd_get(ev, "description"),
        "date":        date_iso,
        "time":        time_hhmm,
        "venue_name":  venue_name or (loc_parts[0] if loc_parts else None),
        "location":    location,
        "latitude":    None,
        "longitude":   None,
        "price_min":   None,
        "price_max":   None,
        "currency":    None,
        "category":    None,
        "url":         _hd_get(ev, "link", "ticketLink"),
        "image":       _hd_get(ev, "thumbnail", "image"),
    }


def _fetch_hasdata(filters):
    place = filters.get("place") or filters.get("city")
    if not place:
        # Google Events es textual: sin nombre de sitio no hay búsqueda.
        return [], 0

    cat_word = HASDATA_CATEGORY_Q.get(filters.get("category"), "events")
    query = "{} in {}".format(cat_word, place)
    if filters.get("q"):
        query = "{} {}".format(filters["q"], query)

    params = {
        "q": query,
        # Google pagina por offset en múltiplos de 10.
        "start": filters["page"] * 10,
    }
    r = requests.get(HASDATA_GEVENTS_URL, params=params, timeout=12, headers={
        "x-api-key": os.getenv("HASDATA_API_KEY"),
        "Accept": "application/json",
    })
    r.raise_for_status()
    data = r.json() or {}

    raw = (data.get("eventsResults") or data.get("events_results")
           or data.get("events") or [])
    events = [_hd_normalize(e) for e in raw if e.get("title")]
    return events, len(events)


# Registro de proveedores: (nombre, fetch, está_configurado).
# Para añadir uno: escribir su _fetch_* (mismo contrato) y sumarlo aquí.
#
# Descartados a sabiendas: Eventbrite (su API de búsqueda pública fue
# eliminada en 2020), Sportradar (solo contratos enterprise),
# API-Football/TheSportsDB (sin búsqueda geográfica — van por liga o
# equipo, otra UX), GDELT (noticias, no eventos — futura capa "news").
PROVIDERS = [
    ("ticketmaster", _fetch_ticketmaster,
     lambda: bool(os.getenv("TICKETMASTER_API_KEY"))),
    ("predicthq", _fetch_predicthq,
     lambda: bool(os.getenv("PREDICTHQ_TOKEN"))),
    ("google", _fetch_hasdata,
     lambda: bool(os.getenv("HASDATA_API_KEY"))),
    ("nager", _fetch_nager,
     lambda: True),  # gratis y sin key — siempre activo
    ("calendarific", _fetch_calendarific,
     lambda: bool(os.getenv("CALENDARIFIC_API_KEY"))),
]


# ── Endpoint ─────────────────────────────────────────────────
@discover_bp.route("/events", methods=["GET"])
@jwt_required()
def discover_events():
    """Query params:
      q         keyword libre
      city      modo viaje ("Madrid", "Paris"...)
      lat, lng  modo "near me" (se ignoran si hay city)
      radius    km alrededor de lat/lng (default 40)
      start,end fechas YYYY-MM-DD
      category  music | sports | arts | film | misc
      page      página del proveedor (default 0)
    """
    configured = [p for p in PROVIDERS if p[2]()]
    if not configured:
        return jsonify({
            "msg": "Event discovery is not configured (missing TICKETMASTER_API_KEY)"
        }), 503

    def _f(name, cast=str):
        v = (request.args.get(name) or "").strip()
        if not v:
            return None
        try:
            return cast(v)
        except (TypeError, ValueError):
            return None

    filters = {
        "q":        _f("q"),
        "city":     _f("city"),
        "lat":      _f("lat", float),
        "lng":      _f("lng", float),
        "radius":   _f("radius", int),
        "start":    _f("start"),
        "end":      _f("end"),
        "category": _f("category"),
        # ISO-3166 alpha-2 ("ES", "FR"…) — lo resuelve el frontend
        # geocodificando la búsqueda; lo usan los proveedores de festivos.
        "country":  _f("country"),
        # Nombre de sitio legible ("Madrid", "Esch-sur-Alzette") — en
        # modo ciudad = lo tecleado; en near-me = reverse-geocoded.
        # Lo usa HasData/Google Events (búsqueda textual).
        "place":    _f("place"),
        "page":     _f("page", int) or 0,
        "size":     20,
    }
    if not filters["city"] and (filters["lat"] is None or filters["lng"] is None):
        return jsonify({"msg": "city or lat+lng is required"}), 400

    cache_key = tuple(sorted((k, str(v)) for k, v in filters.items()))
    cached = _cache_get(cache_key)
    if cached:
        return jsonify(cached), 200

    events, total, statuses = [], 0, {}
    for name, fetch, _ in configured:
        try:
            evs, tot = fetch(filters)
            events.extend(evs)
            total += tot
            statuses[name] = "ok"
        except Exception as exc:
            # Un proveedor caído no tumba la búsqueda entera — pero el
            # motivo SÍ queda en el log del server para diagnosticar
            # (key inválida → 401, parámetro rechazado → 400, etc.).
            print("[discover] provider '{}' failed: {}".format(name, exc))
            statuses[name] = "error"

    if not events and all(s == "error" for s in statuses.values()):
        return jsonify({"msg": "Event providers are unreachable right now"}), 502

    # Dedupe entre proveedores (p. ej. Nager y Calendarific repiten los
    # festivos nacionales): primera aparición gana, por título+fecha.
    seen = set()
    deduped = []
    for e in events:
        key = ((e.get("title") or "").strip().lower(), e.get("date"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(e)
    events = deduped

    events.sort(key=lambda e: (e.get("date") or "9999", e.get("time") or "99:99"))

    payload = {
        "events": events,
        "page": filters["page"],
        "total": total,
        "providers": statuses,
    }
    _cache_set(cache_key, payload)
    return jsonify(payload), 200
