// SignalK App and Plugin interfaces
export interface SignalKApp {
  debug: (msg: string) => void;
  error: (msg: string) => void;
  handleMessage: (pluginId: string, delta: SignalKDelta) => void;
  savePluginOptions: (
    options: Record<string, unknown>,
    callback: (err?: unknown) => void,
  ) => void;
  setProviderStatus: (msg: string) => void;
  setPluginStatus: (msg: string) => void;
  getDataDirPath: () => string;
  getSelfPath: (path: string) => any;
  subscriptionmanager: {
    subscribe: (
      subscription: SubscriptionRequest,
      unsubscribes: Array<() => void>,
      subscriptionError: (err: unknown) => void,
      dataCallback: (delta: SignalKDelta) => void,
    ) => void;
  };
  registerPutHandler: (
    context: string,
    path: string,
    handler: (
      context: string,
      path: string,
      value: unknown,
      callback?: (result: { state: string; statusCode?: number }) => void,
    ) => { state: string; statusCode?: number },
    source?: string,
  ) => void;
  registerWeatherProvider: (provider: WeatherProvider) => void;
}

export interface SignalKPlugin {
  id: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  start: (options: Partial<PluginConfig>, restartPlugin?: () => void) => void;
  stop: () => void;
  registerWithRouter?: (router: any) => void;
  config?: PluginConfig;
}

// Plugin configuration
export interface PluginConfig {
  meteoblueApiKey: string;
  forecastInterval: number;
  altitude: number;
  enablePositionSubscription: boolean;
  maxForecastHours: number;
  maxForecastDays: number;
  // Meteoblue Products
  enableBasic1h: boolean;
  enableBasicDay: boolean;
  enableWind1h: boolean;
  enableWindDay: boolean;
  enableSea1h: boolean;
  enableSeaDay: boolean;
  enableSolar1h: boolean;
  enableSolarDay: boolean;
  enableTrend1h: boolean;
  enableClouds1h: boolean;
  enableCloudsDay: boolean;
  enableAutoMovingForecast: boolean;
  movingSpeedThreshold: number;
}

// Plugin state
export interface PluginState {
  forecastInterval: ReturnType<typeof setInterval> | null;
  accountCheckInterval: ReturnType<typeof setInterval> | null;
  navigationSubscriptions: Array<() => void>;
  currentConfig?: PluginConfig;
  currentPosition: Position | null;
  currentHeading: number | null; // radians, true heading
  currentSOG: number | null; // m/s, speed over ground
  lastForecastUpdate: number;
  lastAccountCheck: number;
  forecastEnabled: boolean;
  accountInfo: ProcessedAccountInfo | null;
  movingForecastEngaged: boolean;
}

// Position data
export interface Position {
  latitude: number;
  longitude: number;
  timestamp: Date;
}

// Predicted position for future forecast hours
export interface PredictedPosition extends Position {
  hour: number; // relative hour (0 = now, 1 = +1 hour, etc.)
  distanceFromCurrent: number; // nautical miles from current position
}

// Meteoblue API response types
export interface MeteoblueResponse {
  metadata: MeteoblueMetadata;
  units: MeteoblueUnits;
  data_1h?: MeteoblueHourlyData;
  data_day?: MeteoblueDailyData;
}

export interface MeteoblueMetadata {
  name: string;
  latitude: number;
  longitude: number;
  height: number;
  timezone_abbrevation: string;
  utc_timeoffset: number;
  modelrun_utc: string;
  modelrun_updatetime_utc: string;
}

export interface MeteoblueUnits {
  time: string;
  temperature: string;
  windspeed: string;
  winddirection: string;
  precipitation: string;
  weather_code: string;
  pressure_msl: string;
  relativehumidity: string;
  visibility: string;
  cloudcover: string;
  uvindex: string;
  cape: string;
  lifted_index: string;
  skin_temperature: string;
  snowfraction: string;
  rain_spot: string;
  predictability_class: string;
  predictability: string;
  precipitation_probability: string;
  convective_precipitation: string;
  sealevelpressure: string;
  total_cloud_cover: string;
  low_cloud_cover: string;
  mid_cloud_cover: string;
  high_cloud_cover: string;
  sunshine_duration: string;
  felttemperature: string;
}

export interface MeteoblueHourlyData {
  time: string[];
  temperature: number[];
  windspeed: number[];
  winddirection: number[];
  precipitation: number[];
  weather_code: number[];
  pressure_msl: number[];
  relativehumidity: number[];
  visibility: number[];
  cloudcover: number[];
  uvindex: number[];
  cape: number[];
  lifted_index: number[];
  skin_temperature: number[];
  snowfraction: number[];
  rain_spot: string[];
  predictability_class: number[];
  predictability: number[];
  precipitation_probability: number[];
  convective_precipitation: number[];
  sealevelpressure: number[];
  total_cloud_cover: number[];
  low_cloud_cover: number[];
  mid_cloud_cover: number[];
  high_cloud_cover: number[];
  sunshine_duration: number[];
  felttemperature: number[];
}

export interface MeteoblueDailyData {
  time: string[];
  temperature_max: number[];
  temperature_min: number[];
  windspeed_max: number[];
  winddirection: number[];
  precipitation: number[];
  weather_code: number[];
  pressure_msl_mean: number[];
  relativehumidity_mean: number[];
  visibility_mean: number[];
  cloudcover_mean: number[];
  uvindex_max: number[];
  predictability_class: number[];
  predictability: number[];
  precipitation_probability: number[];
  convective_precipitation: number[];
  sealevelpressure_mean: number[];
  total_cloud_cover_mean: number[];
  sunshine_duration: number[];
  felttemperature_max: number[];
  felttemperature_min: number[];
}

// Processed forecast data
export interface ProcessedHourlyForecast {
  timestamp: string;
  relativeHour: number;
  temperature: number; // Kelvin
  windSpeed: number; // m/s
  windDirection: number; // radians
  precipitation: number; // m
  weatherCode: number;
  pressure: number; // Pa
  relativeHumidity: number; // ratio 0-1
  visibility: number; // m
  cloudCover: number; // ratio 0-1
  uvIndex: number;
  feltTemperature: number; // Kelvin
  precipitationProbability: number; // ratio 0-1
}

export interface ProcessedDailyForecast {
  date: string;
  dayOfWeek: string;
  temperatureMax: number; // Kelvin
  temperatureMin: number; // Kelvin
  windSpeedMax: number; // m/s
  windDirection: number; // radians
  precipitation: number; // m
  weatherCode: number;
  pressureMean: number; // Pa
  relativeHumidityMean: number; // ratio 0-1
  visibilityMean: number; // m
  cloudCoverMean: number; // ratio 0-1
  uvIndexMax: number;
  precipitationProbability: number; // ratio 0-1
  sunshineDuration: number; // seconds
  feltTemperatureMax: number; // Kelvin
  feltTemperatureMin: number; // Kelvin
}

// SignalK Delta message types
export interface SignalKDelta {
  context: string;
  updates: SignalKUpdate[];
}

export interface SignalKUpdate {
  $source: string;
  timestamp: string;
  values: SignalKValue[];
  meta?: SignalKMeta[];
}

export interface SignalKMeta {
  path: string;
  value: {
    units?: string;
    displayName: string;
    description: string;
  };
}

export interface SignalKValue {
  path: string;
  value: unknown;
}

// Subscription types
export interface SubscriptionRequest {
  context: string;
  subscribe: SubscriptionItem[];
}

export interface SubscriptionItem {
  path: string;
  period?: number;
  format?: string;
  policy?: string;
  minPeriod?: number;
}

export interface SubscriptionValue {
  path: string;
  value: unknown;
  timestamp: string;
  source?: string;
}

// Meteoblue Account API types (Usage API)
export interface MeteoblueAccountResponse {
  usage?: {
    requests_total: number;
    requests_used: number;
    requests_remaining: number;
    period_start: string;
    period_end: string;
  };
  // The actual structure may be different - this is a fallback structure
  [key: string]: unknown;
}

export interface ProcessedAccountInfo {
  username: string;
  email: string;
  company: string;
  country: string;
  timezone: string;
  totalRequests: number;
  usedRequests: number;
  remainingRequests: number;
  usagePercentage: number;
  periodStart: string;
  periodEnd: string;
  status: string;
  lastChecked: string;
}

// Weather API types
export interface WeatherProvider {
  name: string;
  methods: WeatherProviderMethods;
}

export interface WeatherProviderMethods {
  pluginId?: string;
  getObservations: (
    position: Position,
    options?: WeatherReqParams,
  ) => Promise<WeatherData[]>;
  getForecasts: (
    position: Position,
    type: WeatherForecastType,
    options?: WeatherReqParams,
  ) => Promise<WeatherData[]>;
  getWarnings: (position: Position) => Promise<WeatherWarning[]>;
}

export interface WeatherReqParams {
  maxCount?: number;
  startDate?: string;
}

export type WeatherForecastType = "daily" | "point";
export type WeatherDataType = WeatherForecastType | "observation";

export interface WeatherData {
  description?: string;
  longDescription?: string;
  icon?: string;
  date: string;
  type: WeatherDataType;
  current?: {
    drift?: number;
    set?: number;
  };
  outside?: {
    minTemperature?: number;
    maxTemperature?: number;
    feelsLikeTemperature?: number;
    precipitationVolume?: number;
    absoluteHumidity?: number;
    horizontalVisibility?: number;
    uvIndex?: number;
    cloudCover?: number;
    temperature?: number;
    dewPointTemperature?: number;
    pressure?: number;
    pressureTendency?: TendencyKind;
    relativeHumidity?: number;
    precipitationType?: PrecipitationKind;
    // Solar radiation fields
    solarRadiation?: number;
    directNormalIrradiance?: number;
    diffuseHorizontalIrradiance?: number;
    globalHorizontalIrradiance?: number;
    extraterrestrialSolarRadiation?: number;
    // Enhanced cloud data
    totalCloudCover?: number;
    lowCloudCover?: number;
    midCloudCover?: number;
    highCloudCover?: number;
    cloudBaseHeight?: number;
    cloudTopHeight?: number;
    horizontalVisibilityOverRange?: boolean;
    precipitationProbability?: number;
  };
  water?: {
    temperature?: number;
    level?: number;
    levelTendency?: TendencyKind;
    surfaceCurrentSpeed?: number;
    surfaceCurrentDirection?: number;
    salinity?: number;
    waveSignificantHeight?: number;
    wavePeriod?: number;
    waveDirection?: number;
    swellHeight?: number;
    swellPeriod?: number;
    swellDirection?: number;
    // Enhanced marine data
    seaState?: number;
    surfaceWaveHeight?: number;
    windWaveHeight?: number;
    windWavePeriod?: number;
    windWaveDirection?: number;
    swellPeakPeriod?: number;
    windWavePeakPeriod?: number;
    waveSteepness?: number;
    ice?: boolean;
  };
  wind?: {
    speedTrue?: number;
    directionTrue?: number;
    gust?: number;
    gustDirection?: number;
    averageSpeed?: number;
    gustDirectionTrue?: number;
  };
  sun?: {
    sunrise?: string;
    sunset?: string;
    sunshineDuration?: number;
    isDaylight?: boolean;
  };
}

export interface WeatherWarning {
  startTime: string;
  endTime: string;
  details: string;
  source: string;
  type: string;
}

export type TendencyKind =
  | "steady"
  | "decreasing"
  | "increasing"
  | "not available";

export type PrecipitationKind =
  | "reserved"
  | "rain"
  | "thunderstorm"
  | "freezing rain"
  | "mixed/ice"
  | "snow"
  | "reserved"
  | "not available";
