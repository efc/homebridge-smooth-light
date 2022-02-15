# homebridge-smooth-light
[![NPM Version](https://img.shields.io/npm/v/homebridge-smooth-light.svg)](https://www.npmjs.com/package/homebridge-smooth-light)

## Description

This [Homebridge](https://github.com/homebridge/homebridge) plugin exposes a web-based light strip to Apple's [HomeKit](http://www.apple.com/ios/home/). This plugin expects the light strip to expose a specific REST API to allow Homebridge to change the brightness and color of the device. It also expects that once the lock completes the requested action, it will inform a Homebridge "listener" which will then inform HomeKit of the light's new state.

## Motivation

We built a light strip with a microcontroller and wanted to be able to control it with HomeKit. Homebridge looked like the best bet, but we wanted a light plugin that could allow our microcontroller to handle the color and brightness silmultaneously (so that we would always know what HomeKit intended for both). We also wanted to include a one-time token in each transaction between Homebridge and the device so that light would not accept instructions from an unknown source. We don't believe in security-by-firewall, we believe that we should not trust even our home network.

## Installation

1. Install [Homebridge](https://github.com/homebridge/homebridge#installation)
2. Install this plugin in a directory on the same server
3. Use `sudo npm link` to link that installation to your Node package manager
4. Update your `config.json`

Note, once we have a real NPM package available we should simplify this installation procedure.

## Configuration

The configuration of each accessory using this plugin is done by directly editing a bit of JSON in the Homebridge application. The configuration will look something like this.

```json
"accessories": [
     {
       "accessory": "SmoothLight",
       "name": "Smooth Light",
       "deviceRoot": "http://host.org:port/path",
     }
]
```
### Core configuration

None of these core items have default values, so you must define them in the configuration.

| Key          | Description                    |
| ------------ | ------------------------------ |
| `accessory`  | Must be `SmoothLight`          |
| `name`       | Name to appear in the Home app |
| `deviceRoot` | Root URL of your device        |

### Optional configuration

Each of these optional items either has a default value or is not necessary to the operation of the plugin. Of course, you may override any of these default values.

| Key            | Description                                                                                   | Default    |
| -------------- | --------------------------------------------------------------------------------------------- | ---------- |
| `listenerPort` | Port for your HTTP listener (only one listener per port)                                      | `8282`     |
| `pollInterval` | Time (in seconds) between device polls                                                        | `300`      |
| `timeout`      | Time (in seconds) until the accessory will be marked as _Not Responding_ if it is unreachable | `3`        |
| `method`       | HTTP method used to communicate with the device                                               | `GET`      |
| `username`     | Username if HTTP authentication is enabled                                                    | N/A        |
| `password`     | Password if HTTP authentication is enabled                                                    | N/A        |
| `model`        | Appears under the _Model_ field for the accessory                                             | plugin     |
| `serial`       | Appears under the _Serial_ field for the accessory                                            | deviceRoot |
| `manufacturer` | Appears under the _Manufacturer_ field for the accessory                                      | author     |
| `firmware`     | Appears under the _Firmware_ field for the accessory                                          | version    |
| `tokenTimeout` | Time (seconds) until a validation token becomes invalid, use `0` to ignore validation tokens  | `2`        |

## Device API

The device is the microcontroller managing the light itself. We expect that this device is on the network and running a web server capable of responding to the following REST requests.

### Status
```
/status?token=RANDOM_STRING
```

Asks the device to report its status. The device will respond with JSON describing the on/off state as well as the hue, saturation, and brightness values.

```
{
  "is_on": true,
  "hue": 120.0,
  "saturation": 100.0,
  "brightness": 10.0
}
```

### Set Hue

```
/hue/set/FLOAT_VALUE?token=RANDOM_STRING
```

Asks the device to set its hue to the given float value. This value should be in the range of 0 (red) to 120 (green) to 240 (blue) to 360 (red again). The response will be ignored. The `token` value will be one that the listener is prepared to validate with a `/validate` call.


### Set Saturation

```
/saturation/set/FLOAT_VALUE?token=RANDOM_STRING
```

Asks the device to set its saturation to the given float value. This value should be in the range of 0 (white) to 100 (the current hue). The response will be ignored. The `token` value will be one that the listener is prepared to validate with a `/validate` call.


### Set Brightness

```
/brightness/set/FLOAT_VALUE?token=RANDOM_STRING
```

Asks the device to set its brightness to the given float value. This value should be in the range of 0 (off) to 100 (as bright as possible). The response will be ignored. The `token` value will be one that the listener is prepared to validate with a `/validate` call.

Note that a brightness value of 0 should turn the light off, but should probably keep the previously set brightness in place so that turning the light on again brings it directly back to the same brightness.


## Listener API

The listener will be set up by this plugin using the Homebridge's own host name and the `listenerPort` supplied in the configuration. You will have to configure your device to communicate with this specific listener. The listener server responds to the following REST requests.


### Validate

```
/validate?token=STRING
```

Asks the Homebridge listener to validate a token. The listener will respond with 1 if the token was valid or 0 if the token was invalid. This token should be the same token that the device received with the calls to its own API. The listener will respond `valid` if the token is valid, any other response should be considered invalid.

Note that if the `tokenTimeout` supplied in the configuration is set to `0` (zero), then any string you try to validate will be accepted as valid. This effectively breaks security, but can make certain testing easier.

## Changelog

### 1.0.0

Initial version. This plugin owes a lot to [homebridge-http-rgb-push](https://github.com/QuickSander/homebridge-http-rgb-push). While we made quite a few changes, that plugin showed us how all this fits together and works.
