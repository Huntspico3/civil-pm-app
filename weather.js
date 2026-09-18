// Weather integration via Open-Meteo (https://open-meteo.com) — chosen
// specifically because it needs no API key/account, keeping this feature
// simple to deploy. Geocoding turns a project's free-text location (e.g.
// "Denver, CO") into coordinates once (server.js stores the result on the
// project so this only runs again if the location text changes); the daily
// forecast is then fetched by those coordinates and cached briefly here so
// repeat page views don't re-hit the API every time.

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

async function geocodeLocation(query) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Location lookup failed (HTTP ${res.status})`);
  const data = await res.json();
  const match = data.results && data.results[0];
  if (!match) return null;
  const displayName = [match.name, match.admin1, match.country].filter(Boolean).join(', ');
  return { latitude: match.latitude, longitude: match.longitude, displayName };
}

const FORECAST_DAYS = 7;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours — forecasts don't need to be second-fresh
const forecastCache = new Map();

// Deliberately simple, single-threshold rules for "might disrupt outdoor
// construction work" — not real scheduling/trade-specific logic.
const HEAVY_RAIN_MM = 10; // daily total precipitation
const HIGH_RAIN_CHANCE_PCT = 70;
const HIGH_WIND_KMH = 35;

function classifyDay(day) {
  const impactReasons = [];
  if (day.precipitationSum >= HEAVY_RAIN_MM || day.precipitationProbability >= HIGH_RAIN_CHANCE_PCT) {
    impactReasons.push('Heavy rain expected');
  }
  if (day.windSpeedMax >= HIGH_WIND_KMH) {
    impactReasons.push('High wind expected');
  }
  return { impactful: impactReasons.length > 0, impactReasons };
}

async function getForecast(latitude, longitude) {
  const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = forecastCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    forecast_days: String(FORECAST_DAYS),
    timezone: 'auto'
  });
  const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Weather forecast request failed (HTTP ${res.status})`);
  const json = await res.json();
  const daily = json.daily;
  if (!daily || !Array.isArray(daily.time)) throw new Error('Unexpected forecast response shape');

  const days = daily.time.map((date, i) => {
    const day = {
      date,
      weatherCode: daily.weather_code[i],
      tempMax: daily.temperature_2m_max[i],
      tempMin: daily.temperature_2m_min[i],
      precipitationSum: daily.precipitation_sum[i],
      precipitationProbability: daily.precipitation_probability_max[i],
      windSpeedMax: daily.wind_speed_10m_max[i]
    };
    return { ...day, ...classifyDay(day) };
  });

  forecastCache.set(cacheKey, { data: days, fetchedAt: Date.now() });
  return days;
}

module.exports = { geocodeLocation, getForecast };
