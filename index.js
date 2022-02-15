// Homebridge Accessory Plugin: homebridge-smooth-light
// Author: Eric Celeste
// License: MIT License
// Created: February 2022

const packageJson = require('./package.json')
const request = require('request')
const ip = require('ip')
const http = require('http')

module.exports = (api) => {
	api.registerAccessory('homebridge-smooth-light', 'SmoothLight', SmoothLight)
}

class SmoothLight {

	/**
	 * This is the constructor Homebridge will call when creating
	 * a new instance of our accessory.
	 */
	constructor(log, config, api) {
		this.log = log
		this.config = config
		this.api = api

		this.Service = this.api.hap.Service
		this.Characteristic = this.api.hap.Characteristic

		// extract settings from config
		this.name = config.name
		this.deviceRoot = config.deviceRoot
		this.pollInterval = config.pollInterval || 300

		this.listenerPort = config.listenerPort || 8282
		this.requestArray = ['locked', 'unlocked', 'validate']

		this.manufacturer = config.manufacturer || packageJson.author
		this.serial = config.serial || this.deviceRoot
		this.model = config.model || packageJson.name
		this.firmware = config.firmware || packageJson.version

		this.username = config.username || null
		this.password = config.password || null
		this.timeout = config.timeout || 3
		this.method = config.method || 'GET'
		this.tokenTimeout = config.tokenTimeout === 0 ? 0 : (config.tokenTimeout || 2)

		if (this.username != null && this.password != null) {
			this.auth = {
				user: this.username,
				pass: this.password
			}
		}

		this.device = {
			is_on: true,
			is_rainbow: true,
			hue: 120.0,
			saturation: 100.0,
			brightness: 10.0,
		}

		/**
		 * Array of one-time tokens and their expiration date.
		 */
		this.tokens = {}

		// create the listener server
		this.server = http.createServer(function (request, response) {
			const baseURL = 'http://' + request.headers.host + '/'
			const url = new URL(request.url, baseURL)
			const route = url.pathname.substring(1)
			if (this.requestArray.includes(route)) {
				response.end(this.handleListenerRequest(url))
			} else {
				this.log.warn('Invalid request: %s', route)
				response.end('Invalid request')
			}
		}.bind(this))

		this.server.listen(this.listenerPort, function () {
			this.log('Listen server: http://%s:%s', ip.address(), this.listenerPort)
		}.bind(this))

		// create a new Lightbulb service
		this.service = new this.Service.Lightbulb(this.name)
	}

	/**
	 * This is a function that Homebridge calls to learn more about 
	 * our accessory characteristics. Since this happens early in the 
	 * instantiation of our accessory, it also serves as a good place
	 * to set up our status checking interval.
	 * 
	 * @returns {Tuple}
	 */
	getServices() {
		this.informationService = new this.Service.AccessoryInformation()
		this.informationService
			.setCharacteristic(this.Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(this.Characteristic.Model, this.model)
			.setCharacteristic(this.Characteristic.SerialNumber, this.serial)
			.setCharacteristic(this.Characteristic.FirmwareRevision, this.firmware)

		// create handlers for required characteristics
		this.service.getCharacteristic(this.Characteristic.On)
			.onGet(this.handleGetStatus.bind(this))
			.onSet(this.handleSetOn.bind(this))
		this.service.getCharacteristic(this.Characteristic.Hue)
			.onGet(this.handleGetStatus.bind(this))
			.onSet(this.handleSetHue.bind(this))
		this.service.getCharacteristic(this.Characteristic.Saturation)
			.onGet(this.handleGetStatus.bind(this))
			.onSet(this.handleSetSaturation.bind(this))
		this.service.getCharacteristic(this.Characteristic.Brightness)
			.onGet(this.handleGetStatus.bind(this))
			.onSet(this.handleSetBrightness.bind(this))

		// get the initial status and set up regular status retrievals
		this.getStatus(function () { })

		setInterval(() => {
			this.getStatus(function () { })
		}, this.pollInterval * 1000)

		return [this.informationService, this.service]
	}

	/**
	 * Creates a new one-time token and saves it's creation time 
	 * in the tokens dictionary.
	 * 
	 * @returns {String} the new one-time token
	 */
	freshToken() {
		this.pruneTokens()
		const token = Math.random().toString(16).substr(2, 8)
		const now = Date.now()
		this.tokens[token] = now
		this.log.debug("Tokens %s", JSON.stringify(this.tokens))
		return token
	}

	/**
	 * Looks the given token up in the tokens dictionary and
	 * determines if it is still valid or not. Any token that is
	 * looked up is also deleted.
	 * 
	 * @returns {Boolean} True if the token is valid
	 */
	isValidToken(token) {
		token = token.replace(/['""']/g, '')
		const created = this.tokens[token]
		this.log.debug("Checking token '%s' create %s in %s", token, created, JSON.stringify(this.tokens))
		delete this.tokens[token]
		this.pruneTokens()
		return (created && ((created + (this.tokenTimeout * 1000)) > Date.now()))
	}

	/**
	 * Removes from the tokens dictionary all the 
	 * tokens who's time has expired.
	 */
	pruneTokens() {
		const now = Date.now()
		for (var token in this.tokens) {
			if (this.tokens.hasOwnProperty(token) && this.tokens[token] + (this.tokenTimeout * 1000) < now) {
				delete this.tokens[token]
			}
		}
	}

	/**
	 * Decide what to do in response to each route
	 * sent to the listener server.
	 */
	handleListenerRequest(url) {
		const route = url.pathname.substr(1)
		this.log.debug("Handling listener request: %s", route)
		switch (route) {
			case 'locked':
				this.log.debug("Locked")
				this.service.getCharacteristic(this.Characteristic.LockTargetState).updateValue(this.Characteristic.LockCurrentState.SECURED)
				this.service.getCharacteristic(this.Characteristic.LockCurrentState).updateValue(this.Characteristic.LockCurrentState.SECURED)
				this.log('Updated current to locked')
				return ('Homebridge updated')
			case 'unlocked':
				this.log.debug("Unlocked")
				this.service.getCharacteristic(this.Characteristic.LockTargetState).updateValue(this.Characteristic.LockTargetState.UNSECURED)
				this.service.getCharacteristic(this.Characteristic.LockCurrentState).updateValue(this.Characteristic.LockTargetState.UNSECURED)
				this.log('Updated current to unlocked')
				if (this.autolock === 'plugin') {
					this.startAutolockTimer()
				}
				return ('Homebridge updated')
			case 'validate':
				this.log.debug("Validate")
				if (this.tokenTimeout) {
					const token = url.searchParams.get('token')
					if (token) {
						if (!this.isValidToken(token)) {
							return ('invalid token')
						}
					} else {
						return ('missing token')
					}
				}
				return ('valid')
		}
		this.log.warn('Unknown route "%s"', route)
		return ('Unknown route "%s"', route)
	}

	/**
	 * Simplifies making an HTTP request with our standard timeout.
	 */
	httpRequest(url, body, method, callback) {
		request({
			url: url,
			body: body,
			method: this.method,
			timeout: this.timeout * 1000,
			rejectUnauthorized: false,
			auth: this.auth
		}, function (error, response, body) {
			callback(error, response, body)
		})
	}

	/**
	 * Asks the device for its status and passes what the
	 * device reports on to Homebridge.
	 */
	getStatus(callback) {
		const token = this.freshToken()
		const url = this.deviceRoot + '/status?token=' + token
		this.log.debug('Getting status: %s', url)
		this.httpRequest(url, '', 'GET', function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error getting status: %s', error.message)
				callback(error)
			} else {
				this.log.debug('Device response: %s', responseBody)
				try {
					var json = JSON.parse(responseBody)
					this.service.getCharacteristic(this.Characteristic.On).updateValue(json.on)
					this.service.getCharacteristic(this.Characteristic.Hue).updateValue(json.hue)
					this.service.getCharacteristic(this.Characteristic.Saturation).updateValue(json.saturation)
					this.service.getCharacteristic(this.Characteristic.Brightness).updateValue(json.brightness)
					callback()
				} catch (e) {
					this.log.warn('Error parsing status response: %s\nError message: %s', responseBody, e.message)
				}
			}
		}.bind(this))
	}

	/**
	 * Called by Homebridge any time the light is switched on or off.
	 * 
	 * @param {Boolean} value will be true for on, false for off
	 */
	handleSetOn(value) {
		const route = value ? '/switch/on' : '/switch/off'
		const token = this.freshToken()
		const url = this.deviceRoot + route + '?token=' + token + auto
		this.log.debug("Sending: %s", url)
		this.httpRequest(url, '', this.method, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error sending %s: %s', url, error.message)
			} else {
				this.log('Sent %s', url)
			}
		}.bind(this))
	}

	/**
	 * Called by Homebridge to change the hue of the light.
	 * 
	 * @param {Float} value hue
	 */
	handleSetHue(value) {
		const route = '/hue/set/' + value
		const token = this.freshToken()
		const url = this.deviceRoot + route + '?token=' + token + auto
		this.log.debug("Sending: %s", url)
		this.httpRequest(url, '', this.method, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error sending %s: %s', url, error.message)
			} else {
				this.log('Sent %s', url)
			}
		}.bind(this))
	}

	/**
	 * Called by Homebridge to change the saturation of the light.
	 * 
	 * @param {Float} value saturation
	 */
	handleSetHue(value) {
		const route = '/saturation/set/' + value
		const token = this.freshToken()
		const url = this.deviceRoot + route + '?token=' + token + auto
		this.log.debug("Sending: %s", url)
		this.httpRequest(url, '', this.method, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error sending %s: %s', url, error.message)
			} else {
				this.log('Sent %s', url)
			}
		}.bind(this))
	}

	/**
	 * Called by Homebridge to change the brightness of the light.
	 * 
	 * @param {Float} value brightness
	 */
	handleSetHue(value) {
		const route = '/brightness/set/' + value
		const token = this.freshToken()
		const url = this.deviceRoot + route + '?token=' + token + auto
		this.log.debug("Sending: %s", url)
		this.httpRequest(url, '', this.method, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error sending %s: %s', url, error.message)
			} else {
				this.log('Sent %s', url)
			}
		}.bind(this))
	}

}