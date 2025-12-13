# SignalK Meteoblue Ingester 

A SignalK plugin that provides intelligent weather forecast data using the Meteoblue API. This plugin automatically fetches weather forecasts based on your vessel's position and, when moving, predicts weather conditions along your route by calculating future positions from your current heading and speed. All data is published to SignalK in standard units.

Meteoblue offers a rich collection of weather and seastate APIs that are particularly useful to sailors. I have tried to incorporate general weather data as well as seastate and solar conditions.

The data is pushed into SignalK paths and includes many more than those contemplated in the SignalK WEATHER API.

NB: THIS IS PARTIALLY COMPLIANT WITH THE SIGNALK WEATHER API. CURRENTLY, IT IGNORES THE REQUIRED Lat and long, instead it uses the vessel's position or expected position. Also, it does NOT make calls to the underlying API when a WEATHER API request is made, instead it returns the forecast data that already exists in the system. The updating of that data is entirely managed by the plugin.

I plan to add forecast points but I need a small change to the API in order to do that and keep the current functionality, which I have requested.


## Features

- **Position-based forecasts**: Automatically updates forecasts when the vessel moves significantly
- **Vessel movement prediction**: When moving (SOG > 1 knot), forecasts predict weather along the vessel's route based on current heading and speed
- **Multiple forecast packages**: Selectable Meteoblue packages (Basic, Wind, Sea, Solar, Trend, Clouds)
- **Hourly forecasts**: Up to 7 days (168 hours) of hourly weather data
- **Daily forecasts**: Up to 14 days of daily weather summaries
- **Comprehensive data**: Temperature, wind, precipitation, pressure, humidity, visibility, UV index, wave data, and more
- **SignalK standard units**: All data automatically converted to SignalK specification units
- **Account monitoring**: API key validation and usage tracking with automatic notifications
- **Usage alerts**: SignalK notifications when approaching API limits (80% warning, 90% critical)
- **Flexible configuration**: Configurable update intervals and forecast ranges
- **Weather API provider**: Implements SignalK Weather API v2 for ecosystem compatibility
- **Dual compatibility**: Works with both direct SignalK data access and standardized Weather API requests

## Requirements

- SignalK Server v2.16.0 or later
- Meteoblue API key (free tier available)
- Vessel position data (navigation.position)
- Optional for movement prediction: navigation.headingTrue and navigation.speedOverGround

## Installation

1. Install via SignalK App Store, or
2. Clone this repository to your SignalK plugins directory
3. Run `npm install` in the plugin directory
4. Restart SignalK Server

## Configuration

The plugin requires the following configuration:

### Required Settings
- **Meteoblue API Key**: Your API key from Meteoblue (get one at https://www.meteoblue.com/en/weather-api)

### Optional Settings
- **Forecast Update Interval**: How often to fetch new forecasts in minutes (default: 120, minimum: 30)
- **Vessel Altitude**: Altitude above sea level in meters for forecast calculations (default: 15)
- **Enable Position Subscription**: Automatically update forecasts when position changes significantly (default: true)
- **Maximum Hourly Forecast Hours**: Number of hourly forecast periods (default: 72, max: 168)
- **Maximum Daily Forecast Days**: Number of daily forecast periods (default: 10, max: 14)
- **Auto-Enable Moving Forecasts**: Automatically enable moving vessel forecasts when speed exceeds the moving speed threshold (default: true)
- **Moving Speed Threshold**: Speed threshold in knots above which the vessel is considered moving (default: 1.0, range: 0.1-10.0)

### Meteoblue Package Selection
The plugin supports multiple Meteoblue forecast packages. **Basic**, **Wind**, and **Sea** packages are enabled by default:

- **Basic 1h/Day**: Core weather data (temperature, precipitation, wind, pressure, humidity) - **Default: ON**
- **Wind 1h/Day**: Detailed wind data (gusts, direction variations) - **Default: 1h ON, Day OFF**
- **Sea 1h/Day**: Marine conditions (wave height, sea temperature) - **Default: 1h ON, Day OFF**
- **Solar 1h/Day**: Solar radiation and UV data - **Default: OFF**
- **Trend 1h**: Weather trend analysis - **Default: OFF**
- **Clouds 1h/Day**: Detailed cloud cover data - **Default: OFF**

## Data Structure

The plugin publishes weather data to the following SignalK paths:

### System Information
- `environment.outside.meteoblue.system.metadata`: Forecast metadata including location and model run information
- `environment.outside.meteoblue.system.account`: Account information and API usage statistics

### Control Paths
- `commands.meteoblue.engaged`: Boolean control for enabling/disabling moving vessel forecasts (PUT enabled)

### Notifications
- `notifications.meteoblue.apiUsage`: API usage warnings and alerts (SignalK notification format)

### Hourly Forecasts
- `environment.outside.meteoblue.forecast.hourly.{parameter}.{N}`: Individual parameters for each hour (N = 0 to maxHours-1)
- `environment.outside.meteoblue.forecast.hourly.forecastPosition.{N}`: Position where each hourly forecast was calculated

### Daily Forecasts
- `environment.outside.meteoblue.forecast.daily.{parameter}.{N}`: Individual parameters for each day (N = 0 to maxDays-1)
- `environment.outside.meteoblue.forecast.daily.forecastPosition.{N}`: Position where each daily forecast was calculated

### Available Parameters by Package

**Note**: Each package provides different parameters. The specific fields available depend on which Meteoblue packages are enabled.

#### Common Parameters (all forecasts include):
- `timestamp`: ISO 8601 timestamp
- `relativeHour`: Hours relative to current time (hourly only)
- `date`: Date string (daily only)
- `dayOfWeek`: Day of the week name (daily only)

#### Position Information:
- `forecastPosition.{N}`: Position where forecast was calculated, containing:
  ```json
  {
    "latitude": 41.32965333333333,
    "longitude": -72.08823
  }
  ```
  - For stationary vessels: All forecasts use current vessel position
  - For moving vessels: Each forecast uses predicted position for that time period

#### Basic Package Parameters:
- `airTemperature`, `feelsLike`: Temperature data (Kelvin)
- `windAvg`, `windDirection`: Basic wind data (m/s, radians)
- `precip`, `precipProbability`: Precipitation data (meters, ratio 0-1)
- `pictocode`: Meteoblue weather codes
- `relativeHumidity`: Humidity (ratio 0-1)
- `seaLevelPressure`, `stationPressure`: Pressure data (Pascals)
- `uvIndex`: UV index values
- `isDaylight`, `rainSpot`, `convectivePrecip`, `snowFraction`: Additional basic fields

#### Sea Package Parameters:
- `seaSurfaceTemperature`: Sea surface temperature (Kelvin)
- `significantWaveHeight`, `surfWaveHeight`, `windWaveHeight`: Wave heights (meters)
- `swellSignificantHeight`: Swell wave height (meters)
- `meanWavePeriod`, `windWaveMeanPeriod`, `swellMeanPeriod`: Wave periods (seconds)
- `meanWaveDirection`, `windWaveDirection`, `swellMeanDirection`: Wave directions (radians)
- `douglasSeaState`: Douglas sea state scale
- `currentVelocityU`, `currentVelocityV`: Ocean current components (m/s)
- `salinity`: Water salinity

#### Wind Package Parameters:
- `windAvg`, `windDirection`: Wind data (m/s, radians)
- `windGust`: Wind gusts (m/s)
- `windAvg80m`, `windDirection80m`: High-altitude wind data (m/s, radians)
- `airDensity`: Air density (kg/m³)
- `stationPressure`, `seaLevelPressure`: Pressure data (Pascals)

#### Solar Package Parameters:
- `uvIndex`: UV index
- `sunshineDuration`: Sunshine duration (seconds)
- `isDaylight`: Daylight boolean flag

## Position-based Updates

The plugin automatically monitors the vessel's position and updates forecasts when:
1. The configured update interval has elapsed, OR
2. The vessel has moved more than approximately 5 nautical miles from the last forecast location

This ensures you always have relevant local weather data without excessive API calls.

## Vessel Movement Prediction

When the vessel is moving (SOG > 1 knot), the plugin enhances forecasts with predicted positions:

- **Hour 0**: Weather for current position
- **Hour 1**: Weather for predicted position after 1 hour of travel at current heading/speed
- **Hour 2**: Weather for predicted position after 2 hours of travel
- **And so on...**

### Movement-Enhanced Data Fields

When the vessel is moving, **ALL** hourly forecasts (regardless of package) include these additional fields:
- `predictedLatitude`: Predicted latitude for this forecast hour
- `predictedLongitude`: Predicted longitude for this forecast hour  
- `vesselMoving`: Boolean indicating if movement prediction is active

These fields are added to every package's forecast data when movement prediction is active.

### Requirements for Movement Prediction
- Valid position data (`navigation.position`)
- True heading data (`navigation.headingTrue`) 
- Speed over ground exceeding the configured threshold (`navigation.speedOverGround`)

If any navigation data is unavailable, the plugin falls back to standard position-based forecasting.

## Moving Forecast Control

The plugin provides two levels of control over moving vessel forecasts:

### 1. Configuration Setting: "Auto-Enable Moving Forecasts"
- **Location**: Plugin configuration page
- **Default**: Enabled (checked)
- **Purpose**: Controls whether moving forecasts automatically enable when vessel speed exceeds the configured threshold

**When Enabled**:
- Plugin automatically switches to moving forecasts when SOG exceeds the configured threshold
- No manual intervention required
- Provides seamless transition between stationary and moving modes

**When Disabled**:
- Plugin never automatically enables moving forecasts
- User must manually control via the runtime control (see below)
- Provides full manual control over forecast mode

### 2. Runtime Control: `commands.meteoblue.engaged`
- **Location**: SignalK data path `vessels.self.commands.meteoblue.engaged`
- **Type**: Boolean (true/false)
- **Purpose**: Manual override control for moving forecasts

**Usage**:
```bash
# Enable moving forecasts
curl -X PUT http://localhost:3000/signalk/v1/api/vessels/self/commands/meteoblue/engaged \
  -H "Content-Type: application/json" \
  -d '{"value": true}'

# Disable moving forecasts (force stationary mode)
curl -X PUT http://localhost:3000/signalk/v1/api/vessels/self/commands/meteoblue/engaged \
  -H "Content-Type: application/json" \
  -d '{"value": false}'

# Check current state
curl http://localhost:3000/signalk/v1/api/vessels/self/commands/meteoblue/engaged
```

**Behavior**:
- Starts as `false` (disabled) when plugin loads
- Auto-enables to `true` when SOG exceeds the configured threshold (if auto-enable config is enabled)
- Can be manually set to `false` to force stationary forecasting regardless of vessel speed
- Can be manually set to `true` to enable moving forecasts (vessel still needs to be moving above threshold)
- Current state is published to SignalK and visible in Data Browser

### Control Interaction
The two controls work together:

1. **Auto-enable OFF + engaged = false**: Always stationary forecasts
2. **Auto-enable OFF + engaged = true**: Moving forecasts when vessel is moving
3. **Auto-enable ON + engaged = false**: User manually disabled, stays stationary until manually re-enabled
4. **Auto-enable ON + engaged = true**: Automatic behavior active

This provides both convenience (automatic mode switching) and full user control when needed.

## API Usage

The plugin uses the Meteoblue API with configurable packages:
- **Basic packages**: `basic-1h`, `basic-day` - Core weather parameters
- **Wind packages**: `wind-1h`, `wind-day` - Enhanced wind data
- **Sea packages**: `sea-1h`, `sea-day` - Marine conditions
- **Solar packages**: `solar-1h`, `solar-day` - Solar radiation data
- **Trend packages**: `trend-1h` - Weather trend analysis
- **Cloud packages**: `clouds-1h`, `clouds-day` - Detailed cloud data

API calls are made at the configured interval or when position changes significantly. Each enabled package consumes API quota, so select only the packages you need. The free tier typically allows for reasonable usage for most vessels.

## Source Identification and Package-Specific Data

Each Meteoblue package publishes only the data fields relevant to that package type. This ensures that wave data only appears in sea sources, wind gusts only in wind sources, etc.

### Package-Specific Source Data

**`meteoblue-basic-api`** - Core weather data only:
- Temperature, wind speed/direction, precipitation, weather codes
- Pressure, humidity, UV index, precipitation probability
- **Does NOT include**: wave data, wind gusts, marine conditions

**`meteoblue-wind-api`** - Enhanced wind data only:
- Wind speed/direction, wind gusts, high-altitude wind (80m)
- Air density, pressure data
- **Does NOT include**: wave data or marine conditions

**`meteoblue-sea-api`** - Marine and wave data only:
- Wave heights (significant, wind waves, swell), wave periods, wave directions
- Sea surface temperature, Douglas sea state, wave steepness  
- Ocean currents (u/v components), salinity
- **Does NOT include**: basic weather data, wind gusts, atmospheric conditions

**`meteoblue-solar-api`** - Solar radiation data:
- UV index, sunshine duration, daylight information


**`meteoblue-trend-api`** - Weather trend analysis data

**`meteoblue-clouds-api`** - Detailed cloud cover data

**`meteoblue-metadata-api`** - Forecast metadata (location, model run info)

**`meteoblue-account-api`** - API usage statistics and account information

## Data Units

All weather data is automatically converted to [SignalK standard units](https://signalk.org/specification/1.7.0/doc/vesselsBranch.html) where defined, with logical SI units for extensions. **Units are verified from actual Meteoblue API responses.**

**SignalK Metadata**: Each published data point includes SignalK `meta` information specifying the correct units, making the data self-describing for downstream consumers.

### Temperature Data ✅ SignalK Compliant
- **Unit**: Kelvin (K) - [SignalK standard](https://signalk.org/specification/1.7.0/doc/vesselsBranch.html#environmentoutsidetemperature) for temperature
- **Source**: Celsius ("C") from Meteoblue API
- **Conversion**: °C + 273.15
- **Applies to**: `airTemperature`, `feelsLike`, `seaSurfaceTemperature`, `dewPoint`

### Wind Data ✅ SignalK Compliant
- **Speed Unit**: meters per second (m/s) - [SignalK standard](https://signalk.org/specification/1.7.0/doc/vesselsBranch.html#environmentwindspeedapparent) for wind velocity
- **Direction Unit**: radians (rad) - [SignalK standard](https://signalk.org/specification/1.7.0/doc/vesselsBranch.html#environmentwindangleapparent) for angles
- **Source**: **"ms-1" (m/s) and "degree"** from Meteoblue API
- **Conversion**: **NO conversion needed for speed** (already m/s), degrees × (π/180) for direction
- **Applies to**: `windAvg`, `windGust`, `windAvg80m`, `windDirection`, `windDirection80m`

### Atmospheric Pressure ✅ SignalK Compliant
- **Unit**: Pascal (Pa) - [SignalK standard](https://signalk.org/specification/1.7.0/doc/vesselsBranch.html#environmentoutsidepressure) for pressure
- **Source**: hectopascal ("hPa") from Meteoblue API
- **Conversion**: hPa × 100 (hPa = mbar)
- **Applies to**: `seaLevelPressure`, `stationPressure`

### Humidity ✅ SignalK Compliant
- **Unit**: ratio (0-1, dimensionless) - [SignalK standard](https://signalk.org/specification/1.7.0/doc/vesselsBranch.html#environmentoutsiderelativehumidity) for percentages
- **Source**: percentage ("percent") from Meteoblue API
- **Conversion**: % ÷ 100
- **Applies to**: `relativeHumidity`, `cloudCover`, `precipProbability`

### Precipitation 🔸 SI Standard (SignalK not defined)
- **Unit**: meters (m) - Standard SI unit for length/depth
- **Source**: millimeters ("mm") from Meteoblue API
- **Conversion**: mm ÷ 1000
- **Applies to**: `precip`, `convectivePrecip`

### Wave Data 🔸 SI Standard (SignalK not defined)
- **Height Unit**: meters (m) - Standard SI unit for length
- **Period Unit**: seconds (s) - Standard SI unit for time
- **Direction Unit**: radians (rad) - Standard SI unit for angles
- **Source**: meters ("m"), seconds ("s"), and degrees ("degree") from Meteoblue API
- **Conversion**: **NO conversion for heights/periods** (already correct), degrees × (π/180) for directions
- **Applies to**: `significantWaveHeight`, `windWaveHeight`, `swellSignificantHeight`, `meanWavePeriod`, `windWaveMeanPeriod`, `swellMeanPeriod`, `meanWaveDirection`, `windWaveDirection`, `swellMeanDirection`

### Current Velocity 🔸 SI Standard (SignalK not defined)
- **Unit**: meters per second (m/s) - Standard SI unit for velocity
- **Source**: meters per second ("m/s") from Meteoblue API
- **Conversion**: **NO conversion needed** (already m/s)
- **Applies to**: `currentVelocityU`, `currentVelocityV`

### Density 🔸 SI Standard (SignalK not defined)
- **Unit**: kilograms per cubic meter (kg/m³) - Standard SI unit for density
- **Source**: kilograms per cubic meter ("kg/m³") from Meteoblue API
- **Conversion**: **NO conversion needed** (already kg/m³)
- **Applies to**: `airDensity`

### Dimensionless Values
- **Unit**: scalar (no unit) - Direct numeric values
- **Source**: Direct values from Meteoblue API
- **Conversion**: **NO conversion needed**
- **Applies to**: `uvIndex`, `pictocode`, `douglasSeaState`, `isDaylight`, `snowFraction`

### Duration
- **Unit**: seconds (s) - Standard SI unit for time
- **Source**: seconds ("s") from Meteoblue API
- **Conversion**: **NO conversion needed** (already seconds)
- **Applies to**: `sunshineDuration`

### Salinity 🔸 SI Standard (SignalK not defined)
- **Unit**: ratio (dimensionless) - Practical Salinity Unit equivalent
- **Source**: grams per kilogram ("g/kg") from Meteoblue API
- **Conversion**: g/kg ÷ 1000 (oceanographic standard conversion)
- **Applies to**: `salinity`

### Solar Radiation 🔸 SI Standard (SignalK not defined)
- **Unit**: watts per square meter (W/m²) and watt-hours per square meter (W·h/m²)
- **Source**: watts per square meter ("Wm-2") and watt-hours per square meter ("Whm-2") from Meteoblue API
- **Conversion**: **NO conversion needed** (already correct SI units)
- **Applies to**: `radiation`, `radiationtotal`

### Sunshine Duration 🔸 SI Standard (SignalK not defined)
- **Unit**: seconds (s) - Standard SI unit for time
- **Source**: minutes ("minutes") from Meteoblue API
- **Conversion**: minutes × 60
- **Applies to**: `sunshineDuration`

### Visibility 🔸 SI Standard (SignalK not defined)
- **Unit**: meters (m) - Standard SI unit for distance
- **Source**: meters ("m") from Meteoblue API  
- **Conversion**: **NO conversion needed** (already meters)
- **Applies to**: `visibility`

### Generic Probability Fields 🔸 SI Standard (SignalK not defined)
- **Unit**: ratio (0-1, dimensionless) - Standard for probabilities
- **Source**: percentage ("percent") from Meteoblue API
- **Conversion**: % ÷ 100
- **Applies to**: `probability`, other probability fields

**Legend**: ✅ = SignalK specification compliant, 🔸 = Logical SI unit extension

### Data Paths
All packages publish to the same SignalK paths but with different source identifiers:
- Hourly: `environment.outside.meteoblue.forecast.hourly.{parameter}.{index}`
- Daily: `environment.outside.meteoblue.forecast.daily.{parameter}.{index}`

The source label indicates which Meteoblue package the data originated from, allowing consumers to choose data from specific packages or combine data from multiple sources as needed.

## Weather API

The plugin provides standardized access to Meteoblue data through the SignalK Weather API endpoints:

### Endpoints

- **Observations**: `GET /signalk/v2/api/weather/observations?lat=LAT&lon=LON`
- **Point Forecasts**: `GET /signalk/v2/api/weather/forecasts/point?lat=LAT&lon=LON`
- **Daily Forecasts**: `GET /signalk/v2/api/weather/forecasts/daily?lat=LAT&lon=LON`
- **Weather Warnings**: `GET /signalk/v2/api/weather/warnings?lat=LAT&lon=LON`

### Parameters

- `lat` - Latitude (decimal degrees)
- `lon` - Longitude (decimal degrees)
- `maxCount` - Maximum number of records to return (optional)
- `provider` - Provider ID to use (optional, use `signalk-meteoblue` for this plugin)

### Weather API Implementation Limitations

**Important**: This implementation has specific behaviors that differ from typical weather APIs:

**For Observations**:
- Meteoblue does not provide current observations, only forecasts
- Always returns an empty array as per Weather API specification

**For Forecasts**:
- **Position parameters are IGNORED** - The `lat` and `lon` parameters in forecast requests are not used
- Always returns the vessel's cached forecast data regardless of requested coordinates
- **No new API calls** - Returns cached data from periodic Meteoblue API calls
- Forecasts represent weather at the vessel's current or predicted positions

**For Warnings**:
- Weather warnings are not currently supported by this implementation
- Always returns an empty array

This vessel-centric approach prioritizes marine use cases where forecasts follow the vessel's position and predicted route, providing immediate access to cached data without additional API costs.

### Multiple Provider Support

Use `?provider=signalk-meteoblue` to explicitly request Meteoblue data:

```
GET /signalk/v2/api/weather/forecasts/point?lat=41.349&lon=-72.100&provider=signalk-meteoblue
GET /signalk/v2/api/weather/forecasts/daily?lat=41.349&lon=-72.100&maxCount=7&provider=signalk-meteoblue
```

To list all registered weather providers:

```
GET /signalk/v2/api/weather/_providers
```

Compatible with other weather providers (e.g., signalk-weatherflow for station-based observations).

### Data Format

Weather API responses follow the SignalK Weather API specification with proper unit conversions:

```json
{
  "date": "2025-09-22T12:00:00.000Z",
  "type": "point",
  "description": "Partly Cloudy",
  "outside": {
    "temperature": 293.15,
    "pressure": 101325,
    "relativeHumidity": 0.65,
    "feelsLikeTemperature": 292.15,
    "uvIndex": 5,
    "precipitationVolume": 0,
    "precipitationProbability": 0.1
  },
  "wind": {
    "speedTrue": 5.2,
    "directionTrue": 1.57,
    "gust": 8.1
  },
  "water": {
    "seaSurfaceTemperature": 291.15,
    "significantWaveHeight": 1.2,
    "swellHeight": 0.8,
    "swellPeriod": 8,
    "swellDirection": 2.35
  }
}
```

### Benefits of Weather API Integration

1. **Standardized Access**: Works with any SignalK application that supports the Weather API
2. **Best Performance**: Weather API responses use cached vessel forecast data for immediate availability
3. **Marine Advantages**: Unique vessel movement prediction capabilities available via API
4. **No Additional API Costs**: Weather API requests don't trigger new Meteoblue API calls - they use existing cached data
5. **Multiple Providers**: Can be used alongside other weather plugins like signalk-weatherflow

## Troubleshooting

### Common Issues
1. **No forecasts appearing**: Check that you have a valid Meteoblue API key and the vessel has position data
2. **Forecasts not updating**: Verify the position subscription is working and the update interval isn't too long  
3. **API errors**: Check your API key validity and usage limits
4. **"Could not validate API key" warning**: Check your Meteoblue API key and internet connectivity
5. **Usage notifications**: Monitor your API usage in `environment.outside.meteoblue.system.account` - notifications will appear at 80% and 90% usage (this can sometimes be wonky and report wildly incorrect info)
6. **Moving forecasts not working**: Check that "Auto-Enable Moving Forecasts" is enabled in config, or manually enable via `commands.meteoblue.engaged`
7. **Stuck in stationary mode**: Verify vessel has heading and SOG data, or check if moving forecasts are manually disabled via `commands.meteoblue.engaged`

### Debug Information
Enable debug logging in SignalK to see detailed plugin operation including:
- Position updates and forecast triggers
- API requests and responses
- Data processing steps

## Development

Built with TypeScript and follows SignalK plugin standards.

### Building
```bash
npm run build
```

### Linting
```bash
npm run lint
npm run lint:fix
```

### Formatting
```bash
npm run format
npm run format:check
```

## License

MIT License - see LICENSE file for details.

## Credits

Based on the Node-RED weather ingest flows and inspired by the SignalK WeatherFlow plugin architecture. Weather data provided by Meteoblue.