import type { UIToolInvocation } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

export type WeatherUIToolInvocation = UIToolInvocation<typeof weatherTool>

const CONDITIONS = {
  'sunny': { text: 'Sunny', icon: 'i-lucide-sun' },
  'partly-cloudy': { text: 'Partly Cloudy', icon: 'i-lucide-cloud-sun' },
  'cloudy': { text: 'Cloudy', icon: 'i-lucide-cloud' },
  'rainy': { text: 'Rainy', icon: 'i-lucide-cloud-rain' },
  'snowy': { text: 'Snowy', icon: 'i-lucide-snowflake' },
  'stormy': { text: 'Thunderstorms', icon: 'i-lucide-cloud-lightning' },
  'foggy': { text: 'Foggy', icon: 'i-lucide-cloud-fog' }
} as const

/** Maps a WMO weather code (as returned by Open-Meteo) to a display condition. */
export function conditionFromWmoCode(code: number) {
  if (code === 0) return CONDITIONS.sunny
  if (code === 1 || code === 2) return CONDITIONS['partly-cloudy']
  if (code === 3) return CONDITIONS.cloudy
  if (code === 45 || code === 48) return CONDITIONS.foggy
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CONDITIONS.rainy
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CONDITIONS.snowy
  if (code >= 95) return CONDITIONS.stormy
  return CONDITIONS.cloudy
}

function dayLabel(isoDate: string, index: number): string {
  if (index === 0) return 'Today'
  if (index === 1) return 'Tomorrow'
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Weather service responded with ${res.status}`)
  return await res.json() as T
}

/** Real weather from Open-Meteo (free, no API key). Throws when the data cannot be fetched. */
export async function fetchWeather(location: string) {
  const geo = await getJson<{ results?: Array<{ name: string, country?: string, admin1?: string, latitude: number, longitude: number }> }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
  )
  const place = geo.results?.[0]
  if (!place) throw new Error(`Could not find a place called "${location}"`)

  const data = await getJson<{
    current: { temperature_2m: number, relative_humidity_2m: number, wind_speed_10m: number, weather_code: number }
    daily: { time: string[], weather_code: number[], temperature_2m_max: number[], temperature_2m_min: number[] }
  }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}`
    + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5'
  )

  const { current, daily } = data
  return {
    location: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
    temperature: Math.round(current.temperature_2m),
    temperatureHigh: Math.round(daily.temperature_2m_max[0] ?? current.temperature_2m),
    temperatureLow: Math.round(daily.temperature_2m_min[0] ?? current.temperature_2m),
    condition: conditionFromWmoCode(current.weather_code),
    humidity: Math.round(current.relative_humidity_2m),
    windSpeed: Math.round(current.wind_speed_10m),
    dailyForecast: daily.time.map((date, i) => ({
      day: dayLabel(date, i),
      high: Math.round(daily.temperature_2m_max[i] ?? 0),
      low: Math.round(daily.temperature_2m_min[i] ?? 0),
      condition: conditionFromWmoCode(daily.weather_code[i] ?? 3)
    }))
  }
}

export const weatherTool = tool({
  description: 'Get the current weather and a 5-day forecast for a place (temperatures in °C, wind in km/h).',
  inputSchema: z.object({ location: z.string().min(1).max(100).describe('City or place name, e.g. "Lagos" or "Austin, Texas"') }),
  // Errors are thrown on purpose: the chat UI shows an error state instead of made-up numbers.
  execute: async ({ location }) => fetchWeather(location)
})
