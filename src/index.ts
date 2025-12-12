import fetch from "node-fetch";
import {
  SignalKApp,
  SignalKPlugin,
  PluginConfig,
  PluginState,
  Position,
  MeteoblueResponse,
  ProcessedHourlyForecast,
  ProcessedDailyForecast,
  SignalKDelta,
  SubscriptionRequest,
  MeteoblueAccountResponse,
  ProcessedAccountInfo,
  WeatherProvider,
  WeatherData,
  WeatherWarning,
  WeatherReqParams,
  WeatherForecastType,
} from "./types";

export = function (app: SignalKApp): SignalKPlugin {
  const plugin: SignalKPlugin = {
    id: "signalk-meteoblue",
    name: "SignalK Meteoblue Ingester",
    description: "Position-based weather forecast data from Meteoblue API",
    schema: {},
    start: () => {},
    stop: () => {},
  };

  const state: PluginState = {
    forecastInterval: null,
    accountCheckInterval: null,
    navigationSubscriptions: [],
    currentConfig: undefined,
    currentPosition: null,
    currentHeading: null,
    currentSOG: null,
    lastForecastUpdate: 0,
    lastAccountCheck: 0,
    forecastEnabled: true,
    accountInfo: null,
    movingForecastEngaged: false,
  };

  // Meteoblue pictocode mappings
  // Hourly pictocodes: 1-35, Daily pictocodes: 1-17
  // See: https://docs.meteoblue.com/en/meteo/variables/pictograms
  // Icons available at: https://docs.meteoblue.com/en/meteo/variables/pictograms (downloadable ZIP)

  // Short descriptions (WeatherFlow-style, ~17 unique values)
  const pictocodeDescriptions: Record<number, string> = {
    1: "Clear",
    2: "Clear",
    3: "Clear",
    4: "Mostly Clear",
    5: "Mostly Clear",
    6: "Mostly Clear",
    7: "Partly Cloudy",
    8: "Partly Cloudy",
    9: "Partly Cloudy",
    10: "Partly Cloudy",
    11: "Partly Cloudy",
    12: "Partly Cloudy",
    13: "Hazy",
    14: "Hazy",
    15: "Hazy",
    16: "Foggy",
    17: "Foggy",
    18: "Foggy",
    19: "Mostly Cloudy",
    20: "Mostly Cloudy",
    21: "Mostly Cloudy",
    22: "Cloudy",
    23: "Rainy",
    24: "Snow",
    25: "Heavy Rain",
    26: "Heavy Snow",
    27: "Thunderstorms",
    28: "Thunderstorms",
    29: "Snow Storm",
    30: "Thunderstorms",
    31: "Showers",
    32: "Snow Showers",
    33: "Light Rain",
    34: "Light Snow",
    35: "Wintry Mix",
  };

  // Long descriptions (full Meteoblue descriptions)
  const pictocodeLongDescriptions: Record<number, string> = {
    1: "Clear, cloudless sky",
    2: "Clear, few cirrus",
    3: "Clear with cirrus",
    4: "Clear with few low clouds",
    5: "Clear with few low clouds and few cirrus",
    6: "Clear with few low clouds and cirrus",
    7: "Partly cloudy",
    8: "Partly cloudy and few cirrus",
    9: "Partly cloudy and cirrus",
    10: "Mixed with some thunderstorm clouds possible",
    11: "Mixed with few cirrus and some thunderstorm clouds possible",
    12: "Mixed with cirrus and some thunderstorm clouds possible",
    13: "Clear but hazy",
    14: "Clear but hazy with few cirrus",
    15: "Clear but hazy with cirrus",
    16: "Fog or low stratus clouds",
    17: "Fog or low stratus clouds with few cirrus",
    18: "Fog or low stratus clouds with cirrus",
    19: "Mostly cloudy",
    20: "Mostly cloudy and few cirrus",
    21: "Mostly cloudy and cirrus",
    22: "Overcast",
    23: "Overcast with rain",
    24: "Overcast with snow",
    25: "Overcast with heavy rain",
    26: "Overcast with heavy snow",
    27: "Rain, thunderstorms likely",
    28: "Light rain, thunderstorms likely",
    29: "Storm with heavy snow",
    30: "Heavy rain, thunderstorms likely",
    31: "Mixed with showers",
    32: "Mixed with snow showers",
    33: "Overcast with light rain",
    34: "Overcast with light snow",
    35: "Overcast with mixture of snow and rain",
  };

  // Get weather description from pictocode, with fallback
  const getWeatherDescription = (
    pictocode: number | undefined,
    fallback: string,
  ): string => {
    if (pictocode !== undefined && pictocodeDescriptions[pictocode]) {
      return pictocodeDescriptions[pictocode];
    }
    return fallback;
  };

  // Get long weather description from pictocode, with fallback
  const getWeatherLongDescription = (
    pictocode: number | undefined,
    fallback: string,
  ): string => {
    if (pictocode !== undefined && pictocodeLongDescriptions[pictocode]) {
      return pictocodeLongDescriptions[pictocode];
    }
    return fallback;
  };

  // Get icon path from pictocode and daylight status
  // Icons from Meteoblue use zero-padded pictocode: 01_day.svg, 09_night.svg
  // Served from plugin route: /plugins/signalk-meteoblue/icons/meteoblue/{style}/{filename}
  const getWeatherIcon = (
    pictocode: number | undefined,
    isDaylight: boolean | number | undefined,
  ): string | undefined => {
    if (pictocode === undefined) return undefined;
    const paddedCode = pictocode.toString().padStart(2, "0");
    const dayNight = isDaylight === true || isDaylight === 1 ? "day" : "night";
    return `${paddedCode}_${dayNight}.svg`;
  };

  // Configuration schema
  plugin.schema = {
    type: "object",
    required: ["meteoblueApiKey"],
    properties: {
      meteoblueApiKey: {
        type: "string",
        title: "Meteoblue API Key",
        description: "Your Meteoblue API key for weather data access",
        default: "",
      },
      forecastInterval: {
        type: "number",
        title: "Forecast Update Interval (minutes)",
        description: "How often to fetch new forecast data",
        default: 120,
        minimum: 30,
      },
      enableBasic1h: {
        type: "boolean",
        title: "Enable Basic 1h Package",
        description:
          "Basic hourly weather data (temperature, precipitation, wind, etc.)",
        default: true,
      },
      enableBasicDay: {
        type: "boolean",
        title: "Enable Basic Day Package",
        description:
          "Basic daily weather data (temperature, precipitation, wind, etc.)",
        default: true,
      },
      enableWind1h: {
        type: "boolean",
        title: "Enable Wind 1h Package",
        description:
          "Detailed hourly wind data (gusts, direction variations, etc.)",
        default: true,
      },
      enableWindDay: {
        type: "boolean",
        title: "Enable Wind Day Package",
        description: "Daily wind summaries and statistics",
        default: false,
      },
      enableSea1h: {
        type: "boolean",
        title: "Enable Sea 1h Package",
        description: "Hourly marine data (wave height, sea temperature, etc.)",
        default: true,
      },
      enableSeaDay: {
        type: "boolean",
        title: "Enable Sea Day Package",
        description: "Daily marine conditions and statistics",
        default: false,
      },
      enableSolar1h: {
        type: "boolean",
        title: "Enable Solar 1h Package",
        description: "Hourly solar radiation and UV data",
        default: false,
      },
      enableSolarDay: {
        type: "boolean",
        title: "Enable Solar Day Package",
        description: "Daily solar radiation summaries",
        default: false,
      },
      enableTrend1h: {
        type: "boolean",
        title: "Enable Trend 1h Package",
        description: "Hourly weather trend analysis",
        default: false,
      },
      enableClouds1h: {
        type: "boolean",
        title: "Enable Clouds 1h Package",
        description: "Detailed hourly cloud cover data",
        default: false,
      },
      enableCloudsDay: {
        type: "boolean",
        title: "Enable Clouds Day Package",
        description: "Daily cloud cover summaries",
        default: false,
      },
      altitude: {
        type: "number",
        title: "Vessel Altitude (meters)",
        description: "Altitude above sea level for forecast calculations",
        default: 15,
      },
      enablePositionSubscription: {
        type: "boolean",
        title: "Subscribe to Position Updates",
        description:
          "Automatically update forecasts when vessel position changes significantly",
        default: true,
      },
      maxForecastHours: {
        type: "number",
        title: "Maximum Hourly Forecast Hours",
        description: "Maximum number of hourly forecast periods to fetch",
        default: 72,
        minimum: 1,
        maximum: 168,
      },
      maxForecastDays: {
        type: "number",
        title: "Maximum Daily Forecast Days",
        description: "Maximum number of daily forecast periods to fetch",
        default: 10,
        minimum: 1,
        maximum: 14,
      },
      enableAutoMovingForecast: {
        type: "boolean",
        title: "Auto-Enable Moving Forecasts",
        description:
          "Automatically enable moving vessel forecasts when speed exceeds the moving speed threshold. When disabled, moving forecasts must be manually enabled via commands.meteoblue.engaged",
        default: true,
      },
      movingSpeedThreshold: {
        type: "number",
        title: "Moving Speed Threshold (knots)",
        description:
          "Speed threshold above which the vessel is considered moving and triggers moving forecasts",
        default: 1.0,
        minimum: 0.1,
        maximum: 10.0,
      },
    },
  };

  // Utility functions
  const degToRad = (degrees: number): number => degrees * (Math.PI / 180);
  const celsiusToKelvin = (celsius: number): number => celsius + 273.15;
  const mbToPA = (mb: number): number => mb * 100;
  const mmToM = (mm: number): number => mm / 1000;
  const percentToRatio = (percent: number): number => percent / 100;

  // Douglas Sea State scale descriptions
  const douglasSeaStateSimple = (scale: number): string => {
    const descriptions: Record<number, string> = {
      0: "Calm",
      1: "Calm",
      2: "Smooth",
      3: "Slight",
      4: "Moderate",
      5: "Rough",
      6: "Very rough",
      7: "High",
      8: "Very high",
      9: "Phenomenal",
    };
    return descriptions[Math.round(scale)] || `Unknown`;
  };

  const douglasSeaStateVerbose = (scale: number): string => {
    const descriptions: Record<number, string> = {
      0: "Calm (0m) - Sea like a mirror",
      1: "Calm (0-0.1m) - Ripples with appearance of scales, no foam crests",
      2: "Smooth (0.1-0.5m) - Small wavelets, crests of glassy appearance, not breaking",
      3: "Slight (0.5-1.25m) - Large wavelets, crests begin to break, scattered whitecaps",
      4: "Moderate (1.25-2.5m) - Small waves becoming longer, numerous whitecaps",
      5: "Rough (2.5-4m) - Moderate waves, many whitecaps, some spray",
      6: "Very rough (4-6m) - Large waves, whitecaps everywhere, more spray",
      7: "High (6-9m) - Sea heaps up, white foam streaks off breakers",
      8: "Very high (9-14m) - Moderately high waves, crests break into spindrift",
      9: "Phenomenal (>14m) - High waves, dense foam, sea completely white with driving spray",
    };
    return descriptions[Math.round(scale)] || `Unknown (${scale})`;
  };

  // Position prediction utilities for moving vessels
  const calculateFuturePosition = (
    currentPos: Position,
    headingRad: number,
    sogMps: number,
    hoursAhead: number,
  ): Position => {
    // Calculate distance traveled in hoursAhead
    const distanceMeters = sogMps * hoursAhead * 3600; // distance = speed × time (in seconds)

    // Earth's radius in meters
    const earthRadius = 6371000;

    // Convert current position to radians
    const lat1 = degToRad(currentPos.latitude);
    const lon1 = degToRad(currentPos.longitude);

    // Calculate new position using spherical trigonometry
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceMeters / earthRadius) +
        Math.cos(lat1) *
          Math.sin(distanceMeters / earthRadius) *
          Math.cos(headingRad),
    );

    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(headingRad) *
          Math.sin(distanceMeters / earthRadius) *
          Math.cos(lat1),
        Math.cos(distanceMeters / earthRadius) -
          Math.sin(lat1) * Math.sin(lat2),
      );

    return {
      latitude: lat2 * (180 / Math.PI), // Convert back to degrees
      longitude: lon2 * (180 / Math.PI),
      timestamp: new Date(
        currentPos.timestamp.getTime() + hoursAhead * 3600000,
      ),
    };
  };

  const isVesselMoving = (
    sogMps: number,
    thresholdKnots: number = 1.0,
  ): boolean => {
    // Consider vessel moving if SOG > threshold (convert knots to m/s)
    const thresholdMps = thresholdKnots * 0.514444;
    return sogMps > thresholdMps;
  };

  const getSourceLabel = (packageType: string): string => {
    return `meteoblue-${packageType}-api`;
  };

  // Helper functions to read forecast data from SignalK tree
  const getDailyForecastsFromSignalK = (maxCount: number): WeatherData[] => {
    const forecasts: WeatherData[] = [];

    try {
      // Check if we have any data by testing for any field at index 0
      let hasData = false;
      const testFields = ["temperature_max", "windspeed_max", "uvindex"];
      for (const testField of testFields) {
        const data = app.getSelfPath(
          `environment.outside.meteoblue.forecast.daily.${testField}.0`,
        );
        if (data && data.value !== undefined) {
          hasData = true;
          break;
        }
      }
      if (!hasData) {
        app.debug("No daily forecast data found in SignalK tree");
        return forecasts;
      }

      // Find how many forecasts we have by checking consecutive indices
      let forecastCount = 0;
      for (let i = 0; i < maxCount + 10; i++) {
        // Check a bit beyond maxCount
        // Check if any data exists for this index
        let hasDataForIndex = false;
        for (const testField of testFields) {
          const data = app.getSelfPath(
            `environment.outside.meteoblue.forecast.daily.${testField}.${i}`,
          );
          if (data && data.value !== undefined) {
            hasDataForIndex = true;
            break;
          }
        }
        if (hasDataForIndex) {
          forecastCount = i + 1;
        } else {
          break;
        }
      }

      const actualCount = Math.min(forecastCount, maxCount);
      app.debug(`Found ${actualCount} daily forecasts in SignalK tree`);

      for (let i = 0; i < actualCount; i++) {
        const forecastData: any = {};

        // Get ALL published daily forecast fields from all enabled packages
        let allFields: string[] = [];
        if (state.currentConfig) {
          if (state.currentConfig.enableBasicDay)
            allFields.push(...getDailyPackageFields("basic"));
          if (state.currentConfig.enableWindDay)
            allFields.push(...getDailyPackageFields("wind"));
          if (state.currentConfig.enableSeaDay)
            allFields.push(...getDailyPackageFields("sea"));
          if (state.currentConfig.enableSolarDay)
            allFields.push(...getDailyPackageFields("solar"));
          if (state.currentConfig.enableCloudsDay)
            allFields.push(...getDailyPackageFields("clouds"));
        }
        // Remove duplicates
        const fields = [...new Set(allFields)];

        fields.forEach((field) => {
          const data = app.getSelfPath(
            `environment.outside.meteoblue.forecast.daily.${field}.${i}`,
          );
          if (data && data.value !== undefined) {
            forecastData[field] = data.value;
          }
        });

        // Always add forecast if we have any data
        if (Object.keys(forecastData).length > 0) {
          // Generate timestamp if not available
          if (!forecastData.timestamp) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            forecastData.timestamp = date.toISOString().split("T")[0];
          }
          const weatherData = convertToWeatherAPIForecast(
            forecastData,
            "daily",
          );
          forecasts.push(weatherData);
        }
      }
    } catch (error) {
      app.error(
        `Error reading daily forecasts from SignalK: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return forecasts;
  };

  const getHourlyForecastsFromSignalK = (maxCount: number): WeatherData[] => {
    const forecasts: WeatherData[] = [];

    try {
      // Check if we have any data by testing for any field at index 0
      let hasData = false;
      const testFields = [
        "temperature",
        "windspeed",
        "seasurfacetemperature",
        "uvindex",
      ];
      for (const testField of testFields) {
        const data = app.getSelfPath(
          `environment.outside.meteoblue.forecast.hourly.${testField}.0`,
        );
        if (data && data.value !== undefined) {
          hasData = true;
          break;
        }
      }
      if (!hasData) {
        app.debug("No hourly forecast data found in SignalK tree");
        return forecasts;
      }

      // Find how many forecasts we have by checking consecutive indices
      let forecastCount = 0;
      for (let i = 0; i < maxCount + 10; i++) {
        // Check a bit beyond maxCount
        // Check if any data exists for this index
        let hasDataForIndex = false;
        for (const testField of testFields) {
          const data = app.getSelfPath(
            `environment.outside.meteoblue.forecast.hourly.${testField}.${i}`,
          );
          if (data && data.value !== undefined) {
            hasDataForIndex = true;
            break;
          }
        }
        if (hasDataForIndex) {
          forecastCount = i + 1;
        } else {
          break;
        }
      }

      const actualCount = Math.min(forecastCount, maxCount);
      app.debug(`Found ${actualCount} hourly forecasts in SignalK tree`);

      for (let i = 0; i < actualCount; i++) {
        const forecastData: any = {};

        // Get ALL published hourly forecast fields from all enabled packages
        let allFields: string[] = [];
        if (state.currentConfig) {
          if (state.currentConfig.enableBasic1h)
            allFields.push(...getHourlyPackageFields("basic"));
          if (state.currentConfig.enableWind1h)
            allFields.push(...getHourlyPackageFields("wind"));
          if (state.currentConfig.enableSea1h)
            allFields.push(...getHourlyPackageFields("sea"));
          if (state.currentConfig.enableSolar1h)
            allFields.push(...getHourlyPackageFields("solar"));
          if (state.currentConfig.enableClouds1h)
            allFields.push(...getHourlyPackageFields("clouds"));
          if (state.currentConfig.enableTrend1h)
            allFields.push(...getHourlyPackageFields("trend"));
        }
        // Remove duplicates
        const fields = [...new Set(allFields)];

        fields.forEach((field) => {
          const data = app.getSelfPath(
            `environment.outside.meteoblue.forecast.hourly.${field}.${i}`,
          );
          if (data && data.value !== undefined) {
            forecastData[field] = data.value;
          }
        });

        // Always add forecast if we have any data
        if (Object.keys(forecastData).length > 0) {
          // Generate timestamp if not available
          if (!forecastData.timestamp) {
            const date = new Date();
            date.setHours(date.getHours() + i);
            forecastData.timestamp = date.toISOString();
          }
          const weatherData = convertToWeatherAPIForecast(
            forecastData,
            "point",
          );
          forecasts.push(weatherData);
        }
      }
    } catch (error) {
      app.error(
        `Error reading hourly forecasts from SignalK: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return forecasts;
  };

  // Weather API conversion functions
  const convertToWeatherAPIObservation = (forecastData: any): WeatherData => {
    return {
      date: forecastData.timestamp || new Date().toISOString(),
      type: "observation",
      description: getWeatherDescription(
        forecastData.pictocode,
        "Meteoblue weather",
      ),
      longDescription: getWeatherLongDescription(
        forecastData.pictocode,
        "Meteoblue weather forecast",
      ),
      icon: getWeatherIcon(forecastData.pictocode, forecastData.isdaylight),
      outside: {
        temperature: forecastData.temperature, // Already in Kelvin
        pressure: forecastData.sealevelpressure, // Already in Pascal
        relativeHumidity: forecastData.relativehumidity, // Already ratio 0-1
        uvIndex: forecastData.uvindex,
        cloudCover: forecastData.cloudcover, // Already ratio 0-1
        precipitationVolume: forecastData.precipitation, // Already in meters
        feelsLikeTemperature: forecastData.felttemperature,
        horizontalVisibility: forecastData.visibility,
        dewPointTemperature:
          forecastData.dewpoint || forecastData.dewpointtemperature,
        precipitationProbability: forecastData.precipitation_probability,
        pressureTendency:
          forecastData.pressure_trend || forecastData.sealevelpressure_trend
            ? (forecastData.pressure_trend ||
                forecastData.sealevelpressure_trend) > 0
              ? "increasing"
              : (forecastData.pressure_trend ||
                    forecastData.sealevelpressure_trend) < 0
                ? "decreasing"
                : "steady"
            : undefined,
        // Solar radiation fields
        solarRadiation: forecastData.solarradiation,
        directNormalIrradiance: forecastData.irradiance_direct_normal,
        diffuseHorizontalIrradiance: forecastData.irradiance_diffuse_horizontal,
        globalHorizontalIrradiance: forecastData.irradiance_global_horizontal,
        extraterrestrialSolarRadiation:
          forecastData.extraterrestrial_solar_radiation,
        // Enhanced cloud data
        totalCloudCover: forecastData.total_cloud_cover, // Already ratio 0-1
        lowCloudCover: forecastData.low_cloud_cover, // Already ratio 0-1
        midCloudCover: forecastData.mid_cloud_cover, // Already ratio 0-1
        highCloudCover: forecastData.high_cloud_cover, // Already ratio 0-1
        cloudBaseHeight: forecastData.cloud_base_height,
        cloudTopHeight: forecastData.cloud_top_height,
      },
      wind: {
        speedTrue: forecastData.windspeed, // Already in m/s
        directionTrue: forecastData.winddirection, // Already in radians
        gust: forecastData.gust,
        // Enhanced wind data
        averageSpeed: forecastData.windspeed, // Same as speedTrue for compatibility
        gustDirectionTrue: forecastData.gustdirection,
      },
      water: {
        temperature: forecastData.seasurfacetemperature,
        waveSignificantHeight: forecastData.significantwaveheight,
        wavePeriod: forecastData.mean_waveperiod,
        waveDirection: forecastData.mean_wavedirection,
        swellHeight: forecastData.swell_significantheight,
        swellPeriod: forecastData.swell_meanperiod,
        swellDirection: forecastData.swell_meandirection,
        surfaceCurrentSpeed: Math.sqrt(
          (forecastData.currentvelocity_u || 0) ** 2 +
            (forecastData.currentvelocity_v || 0) ** 2,
        ), // Calculate magnitude from u,v components
        surfaceCurrentDirection:
          forecastData.currentvelocity_u && forecastData.currentvelocity_v
            ? Math.atan2(
                forecastData.currentvelocity_v,
                forecastData.currentvelocity_u,
              )
            : undefined, // Calculate direction from u,v components
        salinity: forecastData.salinity,
        // Enhanced marine data
        seaState: forecastData.douglas_seastate,
        surfaceWaveHeight: forecastData.surfwave_height,
        windWaveHeight: forecastData.windwave_height,
        windWavePeriod: forecastData.windwave_meanperiod,
        windWaveDirection: forecastData.windwave_direction,
        swellPeakPeriod: forecastData.swell_peakwaveperiod,
        windWavePeakPeriod: forecastData.windwave_peakwaveperiod,
        waveSteepness: forecastData.wavesteepness,
      },
      sun: {
        sunshineDuration: forecastData.sunshine_duration,
        isDaylight: forecastData.isdaylight === 1, // Convert to boolean
      },
      current: {
        drift: Math.sqrt(
          (forecastData.currentvelocity_u || 0) ** 2 +
            (forecastData.currentvelocity_v || 0) ** 2,
        ), // Surface current speed
        set:
          forecastData.currentvelocity_u && forecastData.currentvelocity_v
            ? Math.atan2(
                forecastData.currentvelocity_v,
                forecastData.currentvelocity_u,
              )
            : undefined, // Surface current direction
      },
    };
  };

  const convertToWeatherAPIForecast = (
    forecastData: any,
    type: WeatherForecastType,
  ): WeatherData => {
    if (type === "daily") {
      // Handle daily forecast with _max/_min/_mean field names
      return {
        date: forecastData.timestamp || new Date().toISOString(),
        type: "daily",
        description: getWeatherDescription(
          forecastData.pictocode,
          "Meteoblue weather",
        ),
        longDescription: getWeatherLongDescription(
          forecastData.pictocode,
          "Meteoblue weather forecast",
        ),
        icon: getWeatherIcon(forecastData.pictocode, true), // Daily forecasts use day icons
        outside: {
          temperature: forecastData.temperature_mean,
          maxTemperature: forecastData.temperature_max,
          minTemperature: forecastData.temperature_min,
          feelsLikeTemperature: forecastData.felttemperature_mean,
          pressure: forecastData.sealevelpressure_mean,
          relativeHumidity: forecastData.relativehumidity_mean, // Already ratio 0-1
          uvIndex: forecastData.uvindex,
          precipitationVolume: forecastData.precipitation, // Already in meters
          dewPointTemperature: forecastData.dewpoint_mean,
          horizontalVisibility: forecastData.visibility_mean,
          precipitationProbability: forecastData.precipitation_probability,
          cloudCover: forecastData.cloudcover_mean, // Already ratio 0-1
          totalCloudCover: forecastData.total_cloud_cover_mean, // Already ratio 0-1
          lowCloudCover: forecastData.low_cloud_cover_mean, // Already ratio 0-1
          midCloudCover: forecastData.mid_cloud_cover_mean, // Already ratio 0-1
          highCloudCover: forecastData.high_cloud_cover_mean, // Already ratio 0-1
          solarRadiation: forecastData.solarradiation_mean,
          directNormalIrradiance: forecastData.irradiance_direct_normal_max,
          diffuseHorizontalIrradiance:
            forecastData.irradiance_diffuse_horizontal_max,
          globalHorizontalIrradiance:
            forecastData.irradiance_global_horizontal_max,
        },
        wind: {
          speedTrue: forecastData.windspeed_max,
          directionTrue: forecastData.winddirection,
          averageSpeed: forecastData.windspeed_mean,
        },
        water: {
          temperature: forecastData.seasurfacetemperature_mean,
          surfaceCurrentSpeed: Math.sqrt(
            (forecastData.currentvelocity_u || 0) ** 2 +
              (forecastData.currentvelocity_v || 0) ** 2,
          ),
          surfaceCurrentDirection:
            forecastData.currentvelocity_u && forecastData.currentvelocity_v
              ? Math.atan2(
                  forecastData.currentvelocity_v,
                  forecastData.currentvelocity_u,
                )
              : undefined,
        },
        sun: {
          sunshineDuration: forecastData.sunshine_duration,
        },
        current: {
          drift: Math.sqrt(
            (forecastData.currentvelocity_u || 0) ** 2 +
              (forecastData.currentvelocity_v || 0) ** 2,
          ),
          set:
            forecastData.currentvelocity_u && forecastData.currentvelocity_v
              ? Math.atan2(
                  forecastData.currentvelocity_v,
                  forecastData.currentvelocity_u,
                )
              : undefined,
        },
      };
    } else {
      // Handle hourly/point forecast - use the existing conversion
      const baseData = convertToWeatherAPIObservation(forecastData);
      baseData.type = type;
      // Description is already set by convertToWeatherAPIObservation using pictocode
      return baseData;
    }
  };

  // Metadata utilities for SignalK compliance
  const getParameterMetadata = (parameterName: string): any => {
    const metadataMap: Record<string, any> = {
      // Temperature parameters (SignalK compliant - Kelvin)
      temperature: {
        units: "K",
        displayName: "Temperature",
        description: "Air temperature forecast",
      },
      felttemperature: {
        units: "K",
        displayName: "Felt Temperature",
        description: "Apparent air temperature forecast",
      },
      seasurfacetemperature: {
        units: "K",
        displayName: "Sea Surface Temperature",
        description: "Sea surface temperature forecast",
      },

      // Wind parameters (SignalK compliant - m/s, radians)
      windspeed: {
        units: "m/s",
        displayName: "Wind Speed",
        description: "Wind speed forecast",
      },
      gust: {
        units: "m/s",
        displayName: "Wind Gust",
        description: "Wind gust speed forecast",
      },
      windspeed_80m: {
        units: "m/s",
        displayName: "Wind Speed 80m",
        description: "Wind speed at 80m altitude forecast",
      },
      winddirection: {
        units: "rad",
        displayName: "Wind Direction",
        description: "Wind direction forecast",
      },
      winddirection_80m: {
        units: "rad",
        displayName: "Wind Direction 80m",
        description: "Wind direction at 80m altitude forecast",
      },

      // Pressure parameters (SignalK compliant - Pascal)
      sealevelpressure: {
        units: "Pa",
        displayName: "Sea Level Pressure",
        description: "Sea level atmospheric pressure forecast",
      },
      surfaceairpressure: {
        units: "Pa",
        displayName: "Surface Air Pressure",
        description: "Surface atmospheric pressure forecast",
      },

      // Humidity parameters (SignalK compliant - ratio 0-1)
      relativehumidity: {
        units: "ratio",
        displayName: "Relative Humidity",
        description: "Relative humidity forecast (0-1)",
      },

      // Precipitation parameters (SI standard - meters)
      precipitation: {
        units: "m",
        displayName: "Precipitation",
        description: "Precipitation amount forecast",
      },
      convective_precipitation: {
        units: "m",
        displayName: "Convective Precipitation",
        description: "Convective precipitation amount forecast",
      },
      precipitation_probability: {
        units: "ratio",
        displayName: "Precipitation Probability",
        description: "Precipitation probability forecast (0-1)",
      },

      // Wave parameters (SI standard - meters, seconds, radians)
      significantwaveheight: {
        units: "m",
        displayName: "Significant Wave Height",
        description: "Significant wave height forecast",
      },
      windwave_height: {
        units: "m",
        displayName: "Wind Wave Height",
        description: "Wind generated wave height forecast",
      },
      swell_significantheight: {
        units: "m",
        displayName: "Swell Height",
        description: "Swell wave height forecast",
      },
      mean_waveperiod: {
        units: "s",
        displayName: "Wave Period",
        description: "Mean wave period forecast",
      },
      windwave_meanperiod: {
        units: "s",
        displayName: "Wind Wave Period",
        description: "Wind wave period forecast",
      },
      swell_meanperiod: {
        units: "s",
        displayName: "Swell Period",
        description: "Swell wave period forecast",
      },
      mean_wavedirection: {
        units: "rad",
        displayName: "Wave Direction",
        description: "Mean wave direction forecast",
      },
      windwave_direction: {
        units: "rad",
        displayName: "Wind Wave Direction",
        description: "Wind wave direction forecast",
      },
      swell_meandirection: {
        units: "rad",
        displayName: "Swell Direction",
        description: "Swell wave direction forecast",
      },

      // Current velocity parameters (SI standard - m/s)
      currentvelocity_u: {
        units: "m/s",
        displayName: "Current Velocity U",
        description: "Ocean current velocity U component forecast",
      },
      currentvelocity_v: {
        units: "m/s",
        displayName: "Current Velocity V",
        description: "Ocean current velocity V component forecast",
      },

      // Density parameters (SI standard - kg/m³)
      airdensity: {
        units: "kg/m³",
        displayName: "Air Density",
        description: "Air density forecast",
      },

      // Salinity parameters (SI standard - ratio)
      salinity: {
        units: "ratio",
        displayName: "Salinity",
        description: "Water salinity forecast",
      },

      // Duration parameters (SI standard - seconds)
      sunshine_duration: {
        units: "s",
        displayName: "Sunshine Duration",
        description: "Sunshine duration forecast",
      },

      // Visibility parameters (SI standard - meters)
      visibility: {
        units: "m",
        displayName: "Visibility",
        description: "Visibility distance forecast",
      },

      // Dimensionless parameters
      uvindex: {
        displayName: "UV Index",
        description: "UV index forecast",
      },
      pictocode: {
        displayName: "Weather Code",
        description: "Meteoblue weather pictogram code",
      },
      douglas_seastate: {
        displayName: "Douglas Sea State",
        description: "Douglas sea state scale forecast",
      },
      douglas_seastate_description: {
        displayName: "Douglas Sea State Description",
        description: "Douglas sea state scale description (simple)",
      },
      douglas_seastate_verbose: {
        displayName: "Douglas Sea State Verbose",
        description:
          "Douglas sea state scale description with wave heights and conditions",
      },
      isdaylight: {
        displayName: "Is Daylight",
        description: "Daylight indicator (0=night, 1=day)",
      },
      snowfraction: {
        displayName: "Snow Fraction",
        description: "Snow fraction of precipitation (0-1)",
      },
      rainspot: {
        displayName: "Rain Spot",
        description: "Local rain probability indicator",
      },
      vesselMoving: {
        displayName: "Vessel Moving",
        description: "Indicates if vessel movement prediction is active",
      },

      // Position parameters for moving vessel forecasts
      predictedLatitude: {
        units: "rad",
        displayName: "Predicted Latitude",
        description: "Predicted vessel latitude for this forecast hour",
      },
      predictedLongitude: {
        units: "rad",
        displayName: "Predicted Longitude",
        description: "Predicted vessel longitude for this forecast hour",
      },

      // Time-related parameters
      relativeHour: {
        units: "h",
        displayName: "Relative Hour",
        description: "Hours from current time",
      },
      dayOfWeek: {
        units: "ratio",
        displayName: "Day of Week",
        description: "Day of the week name",
      },
    };

    // Return exact match or derive metadata from parameter name patterns
    if (metadataMap[parameterName]) {
      return metadataMap[parameterName];
    }

    // Derive units from parameter name patterns
    let units = "";
    let description = `${parameterName} forecast parameter`;

    if (parameterName.includes("temperature")) {
      units = "K";
      description = "Temperature forecast";
    } else if (
      parameterName.includes("windspeed") ||
      parameterName.includes("wind_speed")
    ) {
      units = "m/s";
      description = "Wind speed forecast";
    } else if (parameterName.includes("pressure")) {
      units = "Pa";
      description = "Pressure forecast";
    } else if (parameterName.includes("humidity")) {
      units = "ratio";
      description = "Humidity forecast (0-1)";
    } else if (parameterName === "precipitation_hours") {
      units = "h";
      description = "Hours with precipitation";
    } else if (
      parameterName.includes("precipitation") &&
      !parameterName.includes("probability") &&
      !parameterName.includes("hours")
    ) {
      units = "m";
      description = "Precipitation forecast";
    } else if (parameterName.includes("probability")) {
      units = "ratio";
      description = "Probability forecast (0-1)";
    } else if (parameterName.includes("direction")) {
      units = "rad";
      description = "Direction forecast";
    } else if (parameterName.includes("visibility")) {
      units = "m";
      description = "Visibility forecast";
    } else if (parameterName.includes("uvindex")) {
      units = "";
      description = "UV Index forecast";
    } else {
      // Only use ratio as fallback for truly unknown parameters
      units = "";
      description = `${parameterName} forecast parameter`;
    }

    return {
      units,
      displayName: parameterName,
      description,
    };
  };

  const fetchAccountInfo = async (
    config: PluginConfig,
  ): Promise<ProcessedAccountInfo | null> => {
    try {
      const url = `https://my.meteoblue.com/account/usage?apikey=${config.meteoblueApiKey}`;
      app.debug(`Fetching account info from: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: MeteoblueAccountResponse =
        (await response.json()) as MeteoblueAccountResponse;

      // Process the account data
      app.debug(
        `Account usage data received: ${JSON.stringify(data, null, 2)}`,
      );

      // Process the actual Meteoblue usage API response structure
      let totalCreditsUsed = 0;
      let totalRequests = 0;
      const usageByType: Record<string, { credits: number; count: number }> =
        {};
      let earliestDate = "";
      let latestDate = "";

      if (data.items && Array.isArray(data.items)) {
        // Sum up all usage from the items array
        data.items.forEach((item: any) => {
          totalCreditsUsed += item.request_credits || 0;
          totalRequests += item.request_count || 0;

          // Track usage by request type
          if (item.request_type) {
            if (!usageByType[item.request_type]) {
              usageByType[item.request_type] = { credits: 0, count: 0 };
            }
            usageByType[item.request_type].credits += item.request_credits || 0;
            usageByType[item.request_type].count += item.request_count || 0;
          }

          // Track date range
          if (item.request_date) {
            if (!earliestDate || item.request_date < earliestDate) {
              earliestDate = item.request_date;
            }
            if (!latestDate || item.request_date > latestDate) {
              latestDate = item.request_date;
            }
          }
        });

        app.debug(
          `Total usage: ${totalCreditsUsed} credits, ${totalRequests} requests`,
        );
        app.debug(`Usage by type: ${JSON.stringify(usageByType, null, 2)}`);
      }

      // Estimate monthly limit (common free tier is ~500,000 credits/month)
      const estimatedMonthlyLimit = 500000; // This should be configurable or detected
      const remainingCredits = Math.max(
        0,
        estimatedMonthlyLimit - totalCreditsUsed,
      );

      const processedInfo: ProcessedAccountInfo = {
        username: "Unknown", // Not available in usage API
        email: "Unknown", // Not available in usage API
        company: "Unknown", // Not available in usage API
        country: "Unknown", // Not available in usage API
        timezone: "Unknown", // Not available in usage API
        totalRequests: estimatedMonthlyLimit,
        usedRequests: totalCreditsUsed,
        remainingRequests: remainingCredits,
        usagePercentage:
          estimatedMonthlyLimit > 0
            ? Math.round((totalCreditsUsed / estimatedMonthlyLimit) * 100)
            : 0,
        periodStart: earliestDate,
        periodEnd: latestDate,
        status:
          totalCreditsUsed < estimatedMonthlyLimit
            ? "active"
            : "limit_exceeded",
        lastChecked: new Date().toISOString(),
      };

      return processedInfo;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      app.error(`Failed to fetch account info: ${errorMsg}`);
      return null;
    }
  };

  const publishAccountInfo = (accountInfo: ProcessedAccountInfo): void => {
    const sourceLabel = getSourceLabel("account");
    const path = "environment.outside.meteoblue.system.account";

    const delta: SignalKDelta = {
      context: "vessels.self",
      updates: [
        {
          $source: sourceLabel,
          timestamp: new Date().toISOString(),
          values: [
            {
              path,
              value: accountInfo,
            },
          ],
        },
      ],
    };

    app.handleMessage(plugin.id, delta);
  };

  const checkApiLimits = (accountInfo: ProcessedAccountInfo): void => {
    const usagePercentage = accountInfo.usagePercentage;

    // Clear any existing notifications first
    const notificationPath = "notifications.meteoblue.apiUsage";

    if (usagePercentage >= 90) {
      // Critical warning at 90%+
      const notification = {
        method: ["visual", "sound"],
        state: "alert",
        message: `Meteoblue API usage critical: ${usagePercentage}% used (${accountInfo.remainingRequests} requests remaining)`,
        timestamp: new Date().toISOString(),
      };

      const delta: SignalKDelta = {
        context: "vessels.self",
        updates: [
          {
            $source: getSourceLabel("account"),
            timestamp: new Date().toISOString(),
            values: [
              {
                path: notificationPath,
                value: notification,
              },
            ],
          },
        ],
      };

      app.handleMessage(plugin.id, delta);
      app.debug(`API usage alert sent: ${usagePercentage}% used`);
    } else if (usagePercentage >= 80) {
      // Warning at 80%+
      const notification = {
        method: ["visual"],
        state: "warn",
        message: `Meteoblue API usage high: ${usagePercentage}% used (${accountInfo.remainingRequests} requests remaining)`,
        timestamp: new Date().toISOString(),
      };

      const delta: SignalKDelta = {
        context: "vessels.self",
        updates: [
          {
            $source: getSourceLabel("account"),
            timestamp: new Date().toISOString(),
            values: [
              {
                path: notificationPath,
                value: notification,
              },
            ],
          },
        ],
      };

      app.handleMessage(plugin.id, delta);
      app.debug(`API usage warning sent: ${usagePercentage}% used`);
    } else if (
      usagePercentage < 80 &&
      state.accountInfo &&
      state.accountInfo.usagePercentage >= 80
    ) {
      // Clear notification when usage drops below threshold
      const notification = {
        method: [],
        state: "normal",
        message: `Meteoblue API usage normal: ${usagePercentage}% used`,
        timestamp: new Date().toISOString(),
      };

      const delta: SignalKDelta = {
        context: "vessels.self",
        updates: [
          {
            $source: getSourceLabel("account"),
            timestamp: new Date().toISOString(),
            values: [
              {
                path: notificationPath,
                value: notification,
              },
            ],
          },
        ],
      };

      app.handleMessage(plugin.id, delta);
    }
  };

  const shouldUpdateForecast = (position: Position): boolean => {
    if (!state.currentPosition || !state.lastForecastUpdate) {
      return true;
    }

    const timeSinceUpdate = Date.now() - state.lastForecastUpdate;
    const updateIntervalMs =
      (state.currentConfig?.forecastInterval ?? 120) * 60 * 1000;

    if (timeSinceUpdate >= updateIntervalMs) {
      return true;
    }

    // Check if position has moved significantly (more than ~5 nautical miles)
    const lat1 = state.currentPosition.latitude;
    const lon1 = state.currentPosition.longitude;
    const lat2 = position.latitude;
    const lon2 = position.longitude;

    const R = 6371000; // Earth's radius in meters
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(degToRad(lat1)) *
        Math.cos(degToRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance > 9260; // ~5 nautical miles
  };

  const getEnabledPackages = (config: PluginConfig): string[] => {
    const packages: string[] = [];

    if (config.enableBasic1h) packages.push("basic-1h");
    if (config.enableBasicDay) packages.push("basic-day");
    if (config.enableWind1h) packages.push("wind-1h");
    if (config.enableWindDay) packages.push("wind-day");
    if (config.enableSea1h) packages.push("sea-1h");
    if (config.enableSeaDay) packages.push("sea-day");
    if (config.enableSolar1h) packages.push("solar-1h");
    if (config.enableSolarDay) packages.push("solar-day");
    if (config.enableTrend1h) packages.push("trend-1h");
    if (config.enableClouds1h) packages.push("clouds-1h");
    if (config.enableCloudsDay) packages.push("clouds-day");

    return packages;
  };

  const buildMeteoblueUrl = (
    lat: number,
    lon: number,
    config: PluginConfig,
  ): string => {
    const packages = getEnabledPackages(config);

    if (packages.length === 0) {
      throw new Error("No Meteoblue packages enabled in configuration");
    }

    const packageStr = packages.join("_");
    let url =
      `https://my.meteoblue.com/packages/${packageStr}?` +
      `apikey=${config.meteoblueApiKey}&` +
      `lat=${lat}&` +
      `lon=${lon}&` +
      `asl=${config.altitude}&` +
      `format=json`;

    // Note: starttime/endtime parameters don't work with Meteoblue Forecast API
    // The API always returns data starting from midnight, so we handle time filtering client-side

    return url;
  };

  // Define which fields belong to which package (hourly data)
  const getHourlyPackageFields = (packageType: string): string[] => {
    const fieldMappings: Record<string, string[]> = {
      basic: [
        "temperature",
        "windspeed",
        "winddirection",
        "precipitation",
        "pictocode",
        "relativehumidity",
        "sealevelpressure",
        "surfaceairpressure",
        "uvindex",
        "felttemperature",
        "precipitation_probability",
        "isdaylight",
        "rainspot",
        "convective_precipitation",
        "snowfraction",
        "visibility",
        "dewpoint",
        "dewpointtemperature",
      ],
      wind: [
        "windspeed",
        "winddirection",
        "gust",
        "windspeed_80m",
        "winddirection_80m",
        "airdensity",
        "surfaceairpressure",
        "sealevelpressure",
      ],
      sea: [
        "seasurfacetemperature",
        "significantwaveheight",
        "surfwave_height",
        "windwave_height",
        "swell_significantheight",
        "mean_waveperiod",
        "windwave_meanperiod",
        "swell_meanperiod",
        "windwave_peakwaveperiod",
        "swell_peakwaveperiod",
        "mean_wavedirection",
        "windwave_direction",
        "swell_meandirection",
        "douglas_seastate",
        "wavesteepness",
        "currentvelocity_u",
        "currentvelocity_v",
        "salinity",
      ],
      solar: [
        "uvindex",
        "sunshine_duration",
        "isdaylight",
        "solarradiation",
        "extraterrestrial_solar_radiation",
        "irradiance_direct_normal",
        "irradiance_diffuse_horizontal",
        "irradiance_global_horizontal",
      ],
      trend: [
        "temperature",
        "precipitation",
        "windspeed",
        "winddirection",
        "pressure_trend",
        "temperature_trend",
        "windspeed_trend",
        "sealevelpressure_trend",
      ],
      clouds: [
        "cloudcover",
        "total_cloud_cover",
        "low_cloud_cover",
        "mid_cloud_cover",
        "high_cloud_cover",
        "cloud_base_height",
        "cloud_top_height",
      ],
    };

    return fieldMappings[packageType] || [];
  };

  // Define which fields belong to which package (daily data)
  const getDailyPackageFields = (packageType: string): string[] => {
    const fieldMappings: Record<string, string[]> = {
      basic: [
        "temperature_max",
        "temperature_min",
        "temperature_mean",
        "windspeed_max",
        "windspeed_min",
        "windspeed_mean",
        "winddirection",
        "precipitation",
        "pictocode",
        "relativehumidity_max",
        "relativehumidity_min",
        "relativehumidity_mean",
        "sealevelpressure_max",
        "sealevelpressure_min",
        "sealevelpressure_mean",
        "uvindex",
        "felttemperature_max",
        "felttemperature_min",
        "felttemperature_mean",
        "precipitation_probability",
        "precipitation_hours",
        "snowfraction",
        "rainspot",
        "visibility_mean",
        "dewpoint_max",
        "dewpoint_min",
        "dewpoint_mean",
      ],
      wind: [
        "windspeed_max",
        "windspeed_min",
        "windspeed_mean",
        "winddirection",
        "sealevelpressure_max",
        "sealevelpressure_min",
        "sealevelpressure_mean",
      ],
      sea: [
        // Daily sea data would include wave summaries if available
        "temperature_max",
        "temperature_min", // Sea surface temperature if available
      ],
      solar: [
        "uvindex",
        "sunshine_duration",
        "solarradiation_max",
        "solarradiation_mean",
        "irradiance_direct_normal_max",
        "irradiance_diffuse_horizontal_max",
        "irradiance_global_horizontal_max",
      ],
      trend: [
        "temperature_max",
        "temperature_min",
        "precipitation",
        "windspeed_max",
        "winddirection",
      ],
      clouds: [
        "cloudcover_max",
        "cloudcover_min",
        "cloudcover_mean",
        "total_cloud_cover_max",
        "total_cloud_cover_min",
        "total_cloud_cover_mean",
        "low_cloud_cover_mean",
        "mid_cloud_cover_mean",
        "high_cloud_cover_mean",
      ],
    };

    return fieldMappings[packageType] || [];
  };

  const processHourlyForecastForPackage = (
    data: Record<string, unknown[]> | any,
    maxHours: number,
    packageType: string,
  ): ProcessedHourlyForecast[] => {
    const forecasts: ProcessedHourlyForecast[] = [];

    if (!data || !data.time || !Array.isArray(data.time)) {
      app.error("Invalid hourly forecast data: missing or invalid time array");
      return forecasts;
    }

    const now = new Date();
    const currentHour = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0,
    );
    const allowedFields = getHourlyPackageFields(packageType);

    // Find the starting index for the current or next hour
    let startIndex = 0;
    for (let i = 0; i < data.time.length; i++) {
      const forecastTime = new Date(data.time[i]);
      if (forecastTime >= currentHour) {
        startIndex = i;
        break;
      }
    }

    if (startIndex === 0 && data.time.length > 0) {
      const firstForecastTime = new Date(data.time[0]);
      if (firstForecastTime < currentHour) {
        // All forecast times are in the past, find the closest future one
        for (let i = 0; i < data.time.length; i++) {
          const forecastTime = new Date(data.time[i]);
          if (forecastTime > now) {
            startIndex = i;
            break;
          }
        }
      }
    }

    const count = Math.min(data.time.length - startIndex, maxHours);

    app.debug(
      `Processing ${count} hourly forecasts for ${packageType} package starting from index ${startIndex} (${data.time[startIndex]}) with fields: ${allowedFields.join(", ")}`,
    );

    for (let i = 0; i < count; i++) {
      const dataIndex = startIndex + i;
      const forecastTime = new Date(data.time[dataIndex]);
      const relativeHour = Math.round(
        (forecastTime.getTime() - now.getTime()) / (1000 * 60 * 60),
      );

      const forecast: any = {
        timestamp: data.time[dataIndex],
        relativeHour,
      };

      // Only extract fields that belong to this package
      allowedFields.forEach((field) => {
        const value = data[field]?.[dataIndex];
        if (value !== undefined && value !== null) {
          // Apply unit conversions based on field names
          if (field.includes("temperature") || field === "felttemperature") {
            forecast[field] = celsiusToKelvin(value as number);
          } else if (field.includes("direction") || field === "winddirection") {
            forecast[field] = degToRad(value as number);
          } else if (
            field === "precipitation" ||
            field === "convective_precipitation"
          ) {
            forecast[field] = mmToM(value as number);
          } else if (
            field.includes("pressure") ||
            field === "sealevelpressure"
          ) {
            forecast[field] = mbToPA(value as number);
          } else if (
            field.includes("humidity") ||
            field.includes("cloudcover")
          ) {
            forecast[field] = percentToRatio(value as number);
          } else if (field.includes("precipitation_probability")) {
            forecast[field] = percentToRatio(value as number);
          } else if (field === "douglas_seastate") {
            forecast[field] = value;
            // Add description fields for Douglas Sea State
            forecast["douglas_seastate_description"] = douglasSeaStateSimple(
              value as number,
            );
            forecast["douglas_seastate_verbose"] = douglasSeaStateVerbose(
              value as number,
            );
          } else {
            forecast[field] = value;
          }
        }
      });

      // Movement prediction is now handled by fetchForecastForMovingVessel
      // This function only handles stationary forecasts or fallback scenarios

      forecasts.push(forecast);
    }

    return forecasts;
  };

  const processDailyForecastForPackage = (
    data: Record<string, unknown[]> | any,
    maxDays: number,
    packageType: string,
  ): ProcessedDailyForecast[] => {
    const forecasts: ProcessedDailyForecast[] = [];

    if (!data || !data.time || !Array.isArray(data.time)) {
      app.error("Invalid daily forecast data: missing or invalid time array");
      return forecasts;
    }

    const daysOfWeek = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const count = Math.min(data.time.length, maxDays);
    const allowedFields = getDailyPackageFields(packageType);

    app.debug(
      `Processing ${count} daily forecasts for ${packageType} package with fields: ${allowedFields.join(", ")}`,
    );

    for (let i = 0; i < count; i++) {
      const forecastDate = new Date(data.time[i]);
      const dayOfWeek = daysOfWeek[forecastDate.getDay()];

      const forecast: any = {
        date: data.time[i],
        dayOfWeek,
      };

      // Only extract fields that belong to this package
      allowedFields.forEach((field) => {
        const value = data[field]?.[i];
        if (value !== undefined && value !== null) {
          // Apply unit conversions based on field names
          if (field.includes("temperature") || field === "felttemperature") {
            forecast[field] = celsiusToKelvin(value as number);
          } else if (field.includes("direction") || field === "winddirection") {
            forecast[field] = degToRad(value as number);
          } else if (
            field === "precipitation" ||
            field === "convective_precipitation"
          ) {
            forecast[field] = mmToM(value as number);
          } else if (
            field.includes("pressure") ||
            field === "sealevelpressure"
          ) {
            forecast[field] = mbToPA(value as number);
          } else if (
            field.includes("humidity") ||
            field.includes("cloudcover")
          ) {
            forecast[field] = percentToRatio(value as number);
          } else if (field.includes("precipitation_probability")) {
            forecast[field] = percentToRatio(value as number);
          } else if (field === "douglas_seastate") {
            forecast[field] = value;
            // Add description fields for Douglas Sea State
            forecast["douglas_seastate_description"] = douglasSeaStateSimple(
              value as number,
            );
            forecast["douglas_seastate_verbose"] = douglasSeaStateVerbose(
              value as number,
            );
          } else {
            forecast[field] = value;
          }
        }
      });

      forecasts.push(forecast);
    }

    return forecasts;
  };

  const publishHourlyForecasts = (
    forecasts: ProcessedHourlyForecast[],
    packageType: string,
  ): void => {
    const sourceLabel = getSourceLabel(packageType);

    // Publish individual parameters for each forecast hour (following SignalK pattern)
    forecasts.forEach((forecast, index) => {
      const values: any[] = [];
      const meta: any[] = [];

      Object.entries(forecast).forEach(([key, value]) => {
        if (key === "timestamp") return; // Skip timestamp as it's part of the delta

        const path = `environment.outside.meteoblue.forecast.hourly.${key}.${index}`;
        const metadata = getParameterMetadata(key);

        values.push({ path, value });
        meta.push({ path, value: metadata });
      });

      // Add position information for this forecast (like navigation.position)
      const forecastLat =
        (forecast as any).predictedLatitude || state.currentPosition?.latitude;
      const forecastLon =
        (forecast as any).predictedLongitude ||
        state.currentPosition?.longitude;

      if (forecastLat !== undefined && forecastLon !== undefined) {
        const positionPath = `environment.outside.meteoblue.forecast.hourly.forecastPosition.${index}`;
        const positionValue = {
          latitude: forecastLat,
          longitude: forecastLon,
        };
        const positionMetadata = {
          description: "Position where this forecast was calculated",
          properties: {
            latitude: {
              type: "number",
              description: "Latitude",
              units: "deg",
            },
            longitude: {
              type: "number",
              description: "Longitude",
              units: "deg",
            },
          },
        };
        values.push({ path: positionPath, value: positionValue });
        meta.push({ path: positionPath, value: positionMetadata });
      }

      const delta: SignalKDelta = {
        context: "vessels.self",
        updates: [
          {
            $source: sourceLabel,
            timestamp: forecast.timestamp,
            values,
            meta,
          },
        ],
      };
      app.handleMessage(plugin.id, delta);
    });
  };

  const publishDailyForecasts = (
    forecasts: ProcessedDailyForecast[],
    packageType: string,
  ): void => {
    const sourceLabel = getSourceLabel(packageType);

    // Publish individual parameters for each forecast day (following SignalK pattern)
    forecasts.forEach((forecast, index) => {
      const values: any[] = [];
      const meta: any[] = [];

      Object.entries(forecast).forEach(([key, value]) => {
        if (key === "date") return; // Skip date as it's handled separately

        const path = `environment.outside.meteoblue.forecast.daily.${key}.${index}`;
        const metadata = getParameterMetadata(key);

        values.push({ path, value });
        meta.push({ path, value: metadata });
      });

      // Add position information for this forecast (like navigation.position)
      const forecastLat =
        (forecast as any).predictedLatitude || state.currentPosition?.latitude;
      const forecastLon =
        (forecast as any).predictedLongitude ||
        state.currentPosition?.longitude;

      if (forecastLat !== undefined && forecastLon !== undefined) {
        const positionPath = `environment.outside.meteoblue.forecast.daily.forecastPosition.${index}`;
        const positionValue = {
          latitude: forecastLat,
          longitude: forecastLon,
        };
        const positionMetadata = {
          description: "Position where this forecast was calculated",
          properties: {
            latitude: {
              type: "number",
              description: "Latitude",
              units: "deg",
            },
            longitude: {
              type: "number",
              description: "Longitude",
              units: "deg",
            },
          },
        };
        values.push({ path: positionPath, value: positionValue });
        meta.push({ path: positionPath, value: positionMetadata });
      }

      const delta: SignalKDelta = {
        context: "vessels.self",
        updates: [
          {
            $source: sourceLabel,
            timestamp: new Date().toISOString(),
            values,
            meta,
          },
        ],
      };
      app.handleMessage(plugin.id, delta);
    });
  };

  const fetchForecastForMovingVessel = async (
    config: PluginConfig,
  ): Promise<void> => {
    if (
      !state.currentPosition ||
      !state.currentHeading ||
      !state.currentSOG ||
      !isVesselMoving(state.currentSOG, config.movingSpeedThreshold) ||
      !state.movingForecastEngaged
    ) {
      app.debug(
        "Vessel not moving, missing navigation data, or moving forecast not engaged, falling back to stationary forecast",
      );
      return fetchForecast(state.currentPosition!, config);
    }

    app.debug(
      `Vessel moving at ${(state.currentSOG * 1.943844).toFixed(1)} knots (threshold: ${config.movingSpeedThreshold} knots), heading ${((state.currentHeading * 180) / Math.PI).toFixed(1)}°`,
    );
    app.debug(
      `Fetching position-specific forecasts for ${config.maxForecastHours} hours`,
    );

    const allHourlyForecasts: Record<string, any[]> = {};
    const enabledHourlyPackages = getEnabledPackages(config).filter((pkg) =>
      pkg.includes("-1h"),
    );

    try {
      // Initialize forecast arrays for each package
      enabledHourlyPackages.forEach((packageName) => {
        const packageType = packageName.replace("-1h", "");
        allHourlyForecasts[packageType] = [];
      });

      // Fetch forecast for each hour at predicted positions
      const now = new Date();
      const currentHour = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
        0,
        0,
        0,
      );

      for (let hour = 0; hour < config.maxForecastHours; hour++) {
        const predictedPos = calculateFuturePosition(
          state.currentPosition,
          state.currentHeading,
          state.currentSOG,
          hour,
        );
        const targetTime = new Date(currentHour.getTime() + hour * 3600000); // Current hour + hour offset

        app.debug(
          `Hour ${hour}: Fetching weather for position ${predictedPos.latitude.toFixed(6)}, ${predictedPos.longitude.toFixed(6)} for time ${targetTime.toISOString()}`,
        );

        // Request data from midnight up to the needed hour + buffer to ensure we have the target hour
        const hoursFromMidnight = targetTime.getHours();
        const totalHoursNeeded = hoursFromMidnight + 1 + 2; // Target hour + buffer
        const url = buildMeteoblueUrl(
          predictedPos.latitude,
          predictedPos.longitude,
          config,
        );

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as any;

        if (data.data_1h && data.data_1h.time) {
          enabledHourlyPackages.forEach((packageName) => {
            const packageType = packageName.replace("-1h", "");

            // Process all forecast data first
            const allForecasts = processHourlyForecastForPackage(
              data.data_1h,
              totalHoursNeeded,
              packageType,
            );

            // Find the forecast that matches our target time (current hour + hour offset)
            let targetForecast = null;
            for (const forecast of allForecasts) {
              const forecastTime = new Date(forecast.timestamp);
              // Match by hour (ignore minutes/seconds)
              if (
                forecastTime.getFullYear() === targetTime.getFullYear() &&
                forecastTime.getMonth() === targetTime.getMonth() &&
                forecastTime.getDate() === targetTime.getDate() &&
                forecastTime.getHours() === targetTime.getHours()
              ) {
                targetForecast = forecast;
                break;
              }
            }

            if (targetForecast) {
              const hourForecast = { ...targetForecast } as any;
              hourForecast.predictedLatitude = predictedPos.latitude;
              hourForecast.predictedLongitude = predictedPos.longitude;
              hourForecast.vesselMoving = true;
              allHourlyForecasts[packageType].push(hourForecast);
              app.debug(
                `Added forecast for ${packageType} at position ${predictedPos.latitude.toFixed(6)}, ${predictedPos.longitude.toFixed(6)} for ${targetForecast.timestamp}`,
              );
            } else {
              app.debug(
                `Warning: No forecast found for target time ${targetTime.toISOString()} at position ${predictedPos.latitude.toFixed(6)}, ${predictedPos.longitude.toFixed(6)}`,
              );
            }
          });
        }

        // Add small delay between API calls to be respectful
        if (hour < config.maxForecastHours - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Publish forecasts for each package
      Object.keys(allHourlyForecasts).forEach((packageType) => {
        const forecasts = allHourlyForecasts[packageType];
        if (forecasts.length > 0) {
          publishHourlyForecasts(forecasts, packageType);
          app.debug(
            `Published ${forecasts.length} position-specific forecasts for ${packageType} package`,
          );
        }
      });

      // Handle daily forecasts (still use current position for daily summaries)
      app.debug("Fetching daily forecasts for current position");
      const dailyUrl = buildMeteoblueUrl(
        state.currentPosition.latitude,
        state.currentPosition.longitude,
        config,
      );
      const dailyResponse = await fetch(dailyUrl);
      if (dailyResponse.ok) {
        const dailyData = (await dailyResponse.json()) as any;
        if (dailyData.data_day) {
          const dailyPackages = getEnabledPackages(config).filter((pkg) =>
            pkg.includes("-day"),
          );
          dailyPackages.forEach((packageName) => {
            const packageType = packageName.replace("-day", "");
            const dailyForecasts = processDailyForecastForPackage(
              dailyData.data_day,
              config.maxForecastDays,
              packageType,
            );
            publishDailyForecasts(dailyForecasts, packageType);
          });
          app.debug(
            `Published daily forecasts for packages: ${dailyPackages.join(", ")}`,
          );
        }
      }

      state.lastForecastUpdate = Date.now();
      state.currentPosition = { ...state.currentPosition };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      app.error(`Failed to fetch position-specific forecasts: ${errorMsg}`);
      app.debug("Falling back to stationary forecast");
      return fetchForecast(state.currentPosition!, config);
    }
  };

  const fetchForecast = async (
    position: Position,
    config: PluginConfig,
  ): Promise<void> => {
    if (!config.meteoblueApiKey) {
      app.error("Meteoblue API key not configured");
      return;
    }

    try {
      // Request extra hours to account for data starting from midnight
      const now = new Date();
      const hoursFromMidnight = now.getHours();
      const totalHoursNeeded = hoursFromMidnight + config.maxForecastHours;

      const url = buildMeteoblueUrl(
        position.latitude,
        position.longitude,
        config,
      );
      app.debug(
        `Fetching forecast from: ${url} (requesting ${totalHoursNeeded} hours to account for ${hoursFromMidnight} hours since midnight)`,
      );

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: MeteoblueResponse =
        (await response.json()) as MeteoblueResponse;
      const enabledPackages = getEnabledPackages(config);

      app.debug(
        `Forecast response received. Keys: ${Object.keys(data).join(", ")}`,
      );
      if (data.data_1h)
        app.debug(
          `Hourly data available with ${data.data_1h.time?.length || 0} time periods`,
        );
      if (data.data_day)
        app.debug(
          `Daily data available with ${data.data_day.time?.length || 0} time periods`,
        );

      // Publish metadata
      const metadataPath = "environment.outside.meteoblue.system.metadata";
      const metadataSource = getSourceLabel("metadata");
      const metadataDelta: SignalKDelta = {
        context: "vessels.self",
        updates: [
          {
            $source: metadataSource,
            timestamp: new Date().toISOString(),
            values: [
              {
                path: metadataPath,
                value: data.metadata,
              },
            ],
          },
        ],
      };
      app.handleMessage(plugin.id, metadataDelta);

      // Process and publish hourly forecasts for each enabled hourly package
      if (data.data_1h) {
        const hourlyPackages = enabledPackages.filter((pkg) =>
          pkg.includes("-1h"),
        );
        if (hourlyPackages.length > 0) {
          // Process and publish package-specific data for each enabled package
          hourlyPackages.forEach((packageName) => {
            const packageType = packageName.replace("-1h", "");
            const packageForecasts = processHourlyForecastForPackage(
              data.data_1h,
              config.maxForecastHours,
              packageType,
            );
            publishHourlyForecasts(packageForecasts, packageType);
          });

          app.debug(
            `Published hourly forecasts for packages: ${hourlyPackages.join(", ")}`,
          );
        }
      }

      // Process and publish daily forecasts for each enabled daily package
      if (data.data_day) {
        const dailyPackages = enabledPackages.filter((pkg) =>
          pkg.includes("-day"),
        );
        if (dailyPackages.length > 0) {
          // Process and publish package-specific data for each enabled daily package
          dailyPackages.forEach((packageName) => {
            const packageType = packageName.replace("-day", "");
            const packageForecasts = processDailyForecastForPackage(
              data.data_day,
              config.maxForecastDays,
              packageType,
            );
            publishDailyForecasts(packageForecasts, packageType);
          });

          app.debug(
            `Published daily forecasts for packages: ${dailyPackages.join(", ")}`,
          );
        }
      }

      state.lastForecastUpdate = Date.now();
      state.currentPosition = { ...position };

      app.setPluginStatus(`Last updated: ${new Date().toLocaleString()}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      app.error(`Failed to fetch forecast: ${errorMsg}`);
      app.setPluginStatus(`Error: ${errorMsg}`);

      // IMPORTANT: Update lastForecastUpdate even on failure to prevent endless retries
      state.lastForecastUpdate = Date.now();
    }
  };

  const subscribeToPosition = (config: PluginConfig): void => {
    if (!config.enablePositionSubscription) {
      app.debug("Position subscription disabled in config");
      return;
    }

    app.debug("Setting up position subscription");

    const subscription: SubscriptionRequest = {
      context: "vessels.self",
      subscribe: [
        {
          path: "navigation.position",
          period: 60000, // Check position every minute
          format: "delta",
        },
        {
          path: "navigation.headingTrue",
          period: 60000, // Check heading every minute
          format: "delta",
        },
        {
          path: "navigation.speedOverGround",
          period: 60000, // Check SOG every minute
          format: "delta",
        },
      ],
    };

    // const unsubscribe = () => {};

    app.subscriptionmanager.subscribe(
      subscription,
      state.navigationSubscriptions,
      (err) => {
        app.error(`Position subscription error: ${err}`);
        app.debug(
          "Position subscription failed - forecast updates will only be periodic",
        );
      },
      (delta) => {
        try {
          app.debug("Received position update from subscription");
          // Process navigation updates
          const updates = delta.updates[0]?.values || [];
          let positionUpdate: any = null;

          updates.forEach((update) => {
            if (update.path === "navigation.position") {
              positionUpdate = update;
            } else if (
              update.path === "navigation.headingTrue" &&
              typeof update.value === "number"
            ) {
              state.currentHeading = update.value;
              app.debug(
                `Heading received: ${((update.value * 180) / Math.PI).toFixed(1)}°`,
              );
            } else if (
              update.path === "navigation.speedOverGround" &&
              typeof update.value === "number"
            ) {
              state.currentSOG = update.value;
              app.debug(
                `SOG received: ${(update.value * 1.943844).toFixed(1)} knots`,
              );

              // Auto-enable moving forecast when speed goes over threshold (if auto-enable is enabled)
              if (
                state.currentConfig?.enableAutoMovingForecast &&
                isVesselMoving(
                  update.value,
                  state.currentConfig.movingSpeedThreshold,
                ) &&
                !state.movingForecastEngaged
              ) {
                state.movingForecastEngaged = true;
                app.debug(
                  `Auto-enabled moving forecast due to vessel movement exceeding ${state.currentConfig.movingSpeedThreshold} knots`,
                );

                // Publish the engaged state
                const delta: SignalKDelta = {
                  context: "vessels.self",
                  updates: [
                    {
                      $source: getSourceLabel("control"),
                      timestamp: new Date().toISOString(),
                      values: [
                        {
                          path: "commands.meteoblue.engaged",
                          value: state.movingForecastEngaged,
                        },
                      ],
                    },
                  ],
                };
                app.handleMessage(plugin.id, delta);
              }
            }
          });

          if (
            positionUpdate?.value &&
            typeof positionUpdate.value === "object"
          ) {
            const posValue = positionUpdate.value as {
              latitude: number;
              longitude: number;
            };
            const position: Position = {
              latitude: posValue.latitude,
              longitude: posValue.longitude,
              timestamp: new Date(),
            };

            app.debug(
              `Position received: ${position.latitude}, ${position.longitude}`,
            );

            // Store the position for initial forecast if we don't have one
            if (!state.currentPosition) {
              state.currentPosition = position;
              app.debug("Stored initial position for forecasting");
            }

            if (shouldUpdateForecast(position) && state.currentConfig) {
              app.debug(`Position changed significantly, updating forecast`);

              // Check if vessel is moving and moving forecast is engaged
              if (
                state.currentHeading !== null &&
                state.currentSOG !== null &&
                isVesselMoving(
                  state.currentSOG,
                  state.currentConfig.movingSpeedThreshold,
                ) &&
                state.movingForecastEngaged
              ) {
                app.debug(
                  "Using position-specific forecasting for moving vessel",
                );
                fetchForecastForMovingVessel(state.currentConfig);
              } else {
                app.debug(
                  "Using standard forecasting for stationary vessel or moving forecast disabled",
                );
                fetchForecast(position, state.currentConfig);
              }
            }
          } else {
            // This is normal - SOG/heading updates don't contain position data
            app.debug(`Navigation update processed (non-position data)`);
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          app.error(`Error processing position update: ${errorMsg}`);
        }
      },
    );
  };

  // Weather API Provider Implementation
  const weatherProvider: WeatherProvider = {
    name: "Meteoblue Marine Weather",
    methods: {
      getObservations: async (position: Position): Promise<WeatherData[]> => {
        app.debug(
          `Weather API: getObservations for ${position.latitude}, ${position.longitude}`,
        );

        // Meteoblue does not provide current observations, only forecasts
        // Return empty array as per Weather API specification
        app.debug(
          "Meteoblue provider does not support current observations - only forecasts",
        );
        return [];
      },

      getForecasts: async (
        position: Position,
        type: WeatherForecastType,
        options?: WeatherReqParams,
      ): Promise<WeatherData[]> => {
        app.debug(
          `Weather API: getForecasts ${type} for ${position.latitude}, ${position.longitude}`,
        );

        try {
          // Default to configured max hours/days if not specified
          const defaultCount =
            type === "daily"
              ? state.currentConfig?.maxForecastDays || 10
              : state.currentConfig?.maxForecastHours || 72;
          const maxCount = options?.maxCount || defaultCount;
          const forecasts: WeatherData[] = [];

          // Check if forecast type is enabled in configuration
          if (!state.currentConfig) {
            app.debug("No configuration available for forecast check");
            return forecasts;
          }

          const config = state.currentConfig;
          let hasEnabledPackages = false;

          if (type === "daily") {
            // Check if any daily packages are enabled
            hasEnabledPackages =
              config.enableBasicDay ||
              config.enableWindDay ||
              config.enableSeaDay ||
              config.enableSolarDay ||
              config.enableCloudsDay;
          } else if (type === "point") {
            // Check if any hourly packages are enabled
            hasEnabledPackages =
              config.enableBasic1h ||
              config.enableWind1h ||
              config.enableSea1h ||
              config.enableSolar1h ||
              config.enableClouds1h ||
              config.enableTrend1h;
          }

          if (!hasEnabledPackages) {
            app.debug(
              `No ${type} forecast packages enabled, returning empty array`,
            );
            return forecasts;
          }

          // Fetch forecast data from SignalK tree based on type
          if (type === "daily") {
            return getDailyForecastsFromSignalK(maxCount);
          } else if (type === "point") {
            return getHourlyForecastsFromSignalK(maxCount);
          }

          return forecasts;
        } catch (error) {
          app.error(
            `Weather API getForecasts error: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      },

      getWarnings: async (position: Position): Promise<WeatherWarning[]> => {
        app.debug(
          `Weather API: getWarnings for ${position.latitude}, ${position.longitude}`,
        );

        // TODO: Implement weather warnings from Meteoblue data
        // For now, return empty array
        return [];
      },
    },
  };

  // Plugin lifecycle
  plugin.start = (options: Partial<PluginConfig>) => {
    const config: PluginConfig = {
      meteoblueApiKey: "",
      forecastInterval: 120,
      altitude: 15,
      enablePositionSubscription: true,
      maxForecastHours: 72,
      maxForecastDays: 10,
      // Default packages: basic, wind, and sea enabled
      enableBasic1h: true,
      enableBasicDay: true,
      enableWind1h: true,
      enableWindDay: false,
      enableSea1h: true,
      enableSeaDay: false,
      enableSolar1h: false,
      enableSolarDay: false,
      enableTrend1h: false,
      enableClouds1h: false,
      enableCloudsDay: false,
      enableAutoMovingForecast: true,
      movingSpeedThreshold: 1.0,
      ...options,
    };

    state.currentConfig = config;

    if (!config.meteoblueApiKey) {
      app.error("Meteoblue API key is required");
      app.setPluginStatus("Configuration error: API key required");
      return;
    }

    app.debug("Starting Meteoblue plugin");
    app.setPluginStatus("Initializing...");

    // Register as Weather API provider
    try {
      app.registerWeatherProvider(weatherProvider);
      app.debug("Successfully registered as Weather API provider");
    } catch (error) {
      app.error(
        `Failed to register Weather API provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Publish initial engaged state
    const initialEngagedDelta: SignalKDelta = {
      context: "vessels.self",
      updates: [
        {
          $source: getSourceLabel("control"),
          timestamp: new Date().toISOString(),
          values: [
            {
              path: "commands.meteoblue.engaged",
              value: state.movingForecastEngaged,
            },
          ],
        },
      ],
    };
    app.handleMessage(plugin.id, initialEngagedDelta);

    // Validate API key and fetch initial account info
    setTimeout(async () => {
      const accountInfo = await fetchAccountInfo(config);
      if (accountInfo) {
        state.accountInfo = accountInfo;
        publishAccountInfo(accountInfo);
        checkApiLimits(accountInfo);
        app.debug(
          `API key validated. Usage: ${accountInfo.usagePercentage}% (${accountInfo.remainingRequests} requests remaining)`,
        );
        app.setPluginStatus(
          `Active - ${accountInfo.remainingRequests} API requests remaining`,
        );
      } else {
        app.setPluginStatus("Warning: Could not validate API key");
      }
    }, 2000);

    // Subscribe to position updates
    subscribeToPosition(config);

    // Register PUT handler for moving forecast engaged control
    app.registerPutHandler(
      "vessels.self",
      "commands.meteoblue.engaged",
      (
        _context: string,
        path: string,
        value: unknown,
        callback?: (result: { state: string; statusCode?: number }) => void,
      ) => {
        app.debug(`Received PUT request for ${path}: ${value}`);

        if (typeof value === "boolean") {
          state.movingForecastEngaged = value;
          app.debug(`Moving forecast engaged set to: ${value}`);

          // Publish the current state back to SignalK
          const delta: SignalKDelta = {
            context: "vessels.self",
            updates: [
              {
                $source: getSourceLabel("control"),
                timestamp: new Date().toISOString(),
                values: [
                  {
                    path: "commands.meteoblue.engaged",
                    value: state.movingForecastEngaged,
                  },
                ],
              },
            ],
          };
          app.handleMessage(plugin.id, delta);

          if (callback) {
            callback({ state: "COMPLETED" });
          }
          return { state: "COMPLETED" };
        } else {
          app.error(
            `Invalid value for ${path}: expected boolean, got ${typeof value}`,
          );
          if (callback) {
            callback({ state: "FAILURE", statusCode: 400 });
          }
          return { state: "FAILURE", statusCode: 400 };
        }
      },
      plugin.id,
    );

    // Set up periodic forecast updates
    const intervalMs = config.forecastInterval * 60 * 1000;
    state.forecastInterval = setInterval(async () => {
      if (state.currentPosition && state.forecastEnabled) {
        app.debug("Periodic forecast update");

        // Use appropriate forecast method based on vessel movement and engaged state
        if (
          state.currentHeading !== null &&
          state.currentSOG !== null &&
          isVesselMoving(state.currentSOG, config.movingSpeedThreshold) &&
          state.movingForecastEngaged
        ) {
          app.debug(
            "Periodic update: Using position-specific forecasting for moving vessel",
          );
          await fetchForecastForMovingVessel(config);
        } else {
          app.debug(
            "Periodic update: Using standard forecasting for stationary vessel or moving forecast disabled",
          );
          await fetchForecast(state.currentPosition, config);
        }
      }
    }, intervalMs);

    // Set up periodic account checking (every 6 hours)
    state.accountCheckInterval = setInterval(
      async () => {
        const accountInfo = await fetchAccountInfo(config);
        if (accountInfo) {
          state.accountInfo = accountInfo;
          publishAccountInfo(accountInfo);
          checkApiLimits(accountInfo);
          app.debug(
            `Account info updated. Usage: ${accountInfo.usagePercentage}%`,
          );
        }
      },
      6 * 60 * 60 * 1000,
    ); // 6 hours

    // Initial forecast fetch (try to get current position first)
    setTimeout(async () => {
      // If we have a stored position or can get current position, fetch immediately
      if (state.currentPosition) {
        // Use appropriate forecast method based on initial conditions and engaged state
        if (
          state.currentHeading !== null &&
          state.currentSOG !== null &&
          isVesselMoving(state.currentSOG, config.movingSpeedThreshold) &&
          state.movingForecastEngaged
        ) {
          app.debug(
            "Initial fetch: Using position-specific forecasting for moving vessel",
          );
          await fetchForecastForMovingVessel(config);
        } else {
          app.debug(
            "Initial fetch: Using standard forecasting for stationary vessel or moving forecast disabled",
          );
          await fetchForecast(state.currentPosition, config);
        }
      } else {
        app.debug(
          "No position available yet, will wait for position subscription or manual trigger",
        );
        // For testing, you could add a hardcoded position here:
        // const testPosition = { latitude: 37.7749, longitude: -122.4194, timestamp: new Date() };
        // await fetchForecast(testPosition, config);
      }
    }, 5000); // Wait 5 seconds for position subscription to establish

    app.setPluginStatus("Active");
  };

  plugin.stop = () => {
    app.debug("Stopping Meteoblue plugin");

    // Clear intervals
    if (state.forecastInterval) {
      clearInterval(state.forecastInterval);
      state.forecastInterval = null;
    }

    if (state.accountCheckInterval) {
      clearInterval(state.accountCheckInterval);
      state.accountCheckInterval = null;
    }

    // Clean up subscriptions
    state.navigationSubscriptions.forEach((unsubscribe) => unsubscribe());
    state.navigationSubscriptions = [];

    // Reset state
    state.currentConfig = undefined;
    state.currentPosition = null;
    state.lastForecastUpdate = 0;
    state.lastAccountCheck = 0;
    state.accountInfo = null;
    state.movingForecastEngaged = false;

    app.setPluginStatus("Stopped");
  };

  return plugin;
};
