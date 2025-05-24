import type { PlatformAccessory, Service } from 'homebridge'
import type { ButtonDefinition, OneButtonStatusEvent, Response, SmartBridge } from 'lutron-leap'

import type { DeviceWireResult, GlobalOptions, LutronCasetaLeap } from './platform.js'

import { BluosController, playerMap, players, virtualPlayers } from './bluos/index.js'
import { PicoRemote } from './PicoRemote.js'

export class AudioPicoRemote extends PicoRemote {
  private bluosController: BluosController
  private volumeIntervals: Map<string, ReturnType<typeof setTimeout>> = new Map() // Store intervals for volume buttons
  private readonly VOLUME_REPEAT_INTERVAL = 300 // ms between volume adjustments when button is held
  private commandsForButtons: Map<string, { command: string, modifier: string, player: string }> = new Map() // Track commands for buttons

  constructor(
    platform: LutronCasetaLeap,
    accessory: PlatformAccessory,
    bridge: SmartBridge,
    options: GlobalOptions,
  ) {
    super(platform, accessory, bridge, options)
    this.bluosController = new BluosController(players, virtualPlayers)
  }

  protected async setupButton(
    button: ButtonDefinition,
    service: Service,
    validValues: number[],
    alias: { label: string, index: number, isUpDown: boolean },
  ): Promise<void> {
    // Get player from config based on device serial number
    const player = playerMap.get(
      this.accessory.context.device.SerialNumber.toString(),
    )
    if (!player) {
      this.platform.log.error(
        `No player found for device ${this.accessory.context.device.FullyQualifiedName.join(' ')} with serial number ${this.accessory.context.device.SerialNumber}`,
      )
      return
    }

    const BUTTON_CONFIG = [
      {}, // index 0 unused
      { command: 'start' },
      { command: 'volume', single: { modifier: 'up' }, double: { modifier: 'up', modifier2: 'double' } },
      { command: 'preset', single: { modifier: 'next' }, double: { modifier: 'previous' } },
      { command: 'volume', single: { modifier: 'down' }, double: { modifier: 'down', modifier2: 'double' } },
      { command: 'stop' },
    ]
    const buttonConfig = BUTTON_CONFIG[alias.index] ?? {}
    const command = buttonConfig.command ?? ''

    // Store command info for this button for use in handleEvent
    if (command === 'volume' && buttonConfig.single?.modifier) {
      this.commandsForButtons.set(button.href, {
        command,
        modifier: buttonConfig.single.modifier,
        player,
      })
    }

    const sendPlayerCommand = async (modifier: string, modifier2: string) => {
      this.platform.log.info(
        `Sending player command: ${player} ${command} ${modifier} ${modifier2}`,
      )
      try {
        await this.bluosController.controlPlayer(player, command, modifier, modifier2)
      } catch (error) {
        this.platform.log.error('Error sending player command:', error)
      }
      return null
    }

    const SINGLE_PRESS = () => {
      const modifier = buttonConfig.single?.modifier ?? ''
      return sendPlayerCommand(modifier, '')
    }

    const DOUBLE_PRESS = () => {
      const modifier = buttonConfig.double?.modifier ?? ''
      const modifier2 = buttonConfig.double?.modifier2 ?? ''
      return sendPlayerCommand(modifier, modifier2)
    }

    // Handle long press for volume buttons
    const LONG_PRESS = () => {
      // If this is a volume button (up or down), start sending volume commands at intervals
      if (command === 'volume' && buttonConfig.single?.modifier) {
        const modifier = buttonConfig.single.modifier
        this.startContinuousVolumeAdjustment(button.href, player, modifier, sendPlayerCommand)
        this.platform.log.info(`Long press detected on ${alias.label} button - continuous volume ${modifier}`)
      }

      return null
    }

    // Use helper method to set up button tracker and service
    // Only allow DOUBLE_PRESS for buttons that have double modifier configured
    const hasDoublePress = buttonConfig.double !== undefined

    // If no single/double modifiers in BUTTON_CONFIG, only allow SINGLE_PRESS
    if (!buttonConfig.single && !buttonConfig.double) {
      // Update validValues to only include SINGLE_PRESS
      validValues = [this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS]

      // Update the characteristic properties
      service
        .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
        .setProps({
          maxValue: this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
          validValues,
        })
    }

    // Use null function for DOUBLE_PRESS if the button doesn't support it
    const doublePressFn = hasDoublePress ? DOUBLE_PRESS : () => null
    this.setupButtonTracker(button.href, service, SINGLE_PRESS, doublePressFn, LONG_PRESS, alias.isUpDown)
  }

  public async initialize(): Promise<DeviceWireResult> {
    const result = await super.initialize()
    return result
  }

  // Override the handleEvent method from PicoRemote to add volume control functionality
  handleEvent(response: Response): void {
    // Call the parent implementation first
    super.handleEvent(response)

    const evt = (response.Body! as OneButtonStatusEvent).ButtonStatus
    const buttonHref = evt.Button.href
    const eventType = evt.ButtonEvent.EventType

    // If this is a volume button and we have command info for it
    if (this.commandsForButtons.has(buttonHref)) {
      const buttonInfo = this.commandsForButtons.get(buttonHref)!

      // For release events, stop continuous volume if it's running
      if (eventType === 'Release') {
        if (this.volumeIntervals.has(buttonHref)) {
          clearInterval(this.volumeIntervals.get(buttonHref)!)
          this.volumeIntervals.delete(buttonHref)
          this.platform.log.info(`Button released - stopped continuous volume for player ${buttonInfo.player}`)
        }
      }
    }
  }

  /**
   * Start continuous volume adjustment at fixed intervals for a specific button
   */
  private startContinuousVolumeAdjustment(
    buttonHref: string,
    player: string,
    modifier: string,
    sendCommandFn?: (modifier: string, modifier2: string) => Promise<any>,
  ): void {
    // Clear any existing interval for this button
    if (this.volumeIntervals.has(buttonHref)) {
      clearInterval(this.volumeIntervals.get(buttonHref)!)
      this.volumeIntervals.delete(buttonHref)
    }

    // Function to send volume command - either use provided function or send directly
    const sendCommand = sendCommandFn
      || (async (mod: string, mod2: string) => {
        try {
          await this.bluosController.controlPlayer(player, 'volume', mod, mod2)
        } catch (error) {
          this.platform.log.error('Error sending player command:', error)
        }
      })

    // Set up recurring volume adjustments
    const interval = setInterval(() => {
      this.platform.log.debug(
        `Continuous volume ${modifier} for ${player}`,
      )
      sendCommand(modifier, '')
    }, this.VOLUME_REPEAT_INTERVAL)

    // Store the interval reference to clear it later
    this.volumeIntervals.set(buttonHref, interval)

    // Send initial command immediately
    sendCommand(modifier, '')

    this.platform.log.info(`Started continuous volume ${modifier} for player ${player}`)
  }

  // Clean up any ongoing intervals when the device is removed
  public destroy(): void {
    // Clear all volume intervals
    for (const interval of this.volumeIntervals.values()) {
      clearInterval(interval)
    }
    this.volumeIntervals.clear()
    this.commandsForButtons.clear()
  }
}
