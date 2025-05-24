import axios from 'axios'

export interface PlayerConfig {
  ip: string
  port: number
  volume: number
  preset: number
}

export interface VirtualPlayerConfig {
  name: string
  primary: PlayerConfig
  slaves: PlayerConfig[]
}

export interface Players {
  [key: string]: PlayerConfig
}

export interface VirtualPlayers {
  [key: string]: VirtualPlayerConfig
}

export class BluosController {
  private players: Players
  private virtualPlayers: VirtualPlayers

  constructor(players: Players, virtualPlayers: VirtualPlayers) {
    this.players = players
    this.virtualPlayers = virtualPlayers
  }

  private async makeRequest(url: string): Promise<string> {
    try {
      await axios.get(url, { timeout: 5000 })
      return 'success'
    } catch (error) {
      console.error(`Error making request to ${url}:`, error)
      return 'error'
    }
  }

  private async getPlayerStatus(
    player: PlayerConfig,
  ): Promise<{ isPlaying: boolean, isTv: boolean }> {
    try {
      const response = await axios.get(
        `http://${player.ip}:${player.port}/Status`,
        { timeout: 5000 },
      )
      const status = response.data
      const isPlaying = /<state>(?:stream|play)<\/state>/.test(status)
      const isTv = /<title1>TV<\/title1>/.test(status)
      return { isPlaying, isTv }
    } catch (error) {
      console.error('Error getting player status:', error)
      return { isPlaying: false, isTv: false }
    }
  }

  private async ungroupPlayers(
    primaryPlayer: PlayerConfig,
    slaves: PlayerConfig[],
  ): Promise<void> {
    const otherPlayers = Object.values(this.players).filter(
      player =>
        player.ip !== primaryPlayer.ip
        || (player.port !== primaryPlayer.port
          && !slaves.some(
            slave => slave.ip === player.ip && slave.port === player.port,
          )),
    )

    const slavesString = otherPlayers.map(p => p.ip).join(',')
    const portsString = otherPlayers.map(p => p.port).join(',')

    // Ungroup primary and all slaves from other players
    const allPlayersToUngroup = [primaryPlayer, ...slaves]
    await Promise.all(
      allPlayersToUngroup.map(player =>
        this.makeRequest(
          `http://${player.ip}:${player.port}/RemoveSlave?slaves=${slavesString}&ports=${portsString}`,
        ),
      ),
    )
  }

  private async controlVolume(
    players: PlayerConfig[],
    modifier: string,
    modifier2?: string,
  ): Promise<void> {
    const delta = modifier2 === 'double' ? '4' : '2'
    const sign = modifier === 'down' ? '-' : ''
    await Promise.all(
      players.map(player =>
        this.makeRequest(
          `http://${player.ip}:${player.port}/Volume?db=${sign}${delta}&tell_slaves=1`,
        ),
      ),
    )
  }

  private async controlPreset(
    players: PlayerConfig[],
    modifier: string,
  ): Promise<void> {
    const sign = modifier === 'next' ? '+' : '-'
    await Promise.all(
      players.map(player =>
        this.makeRequest(
          `http://${player.ip}:${player.port}/Preset?id=${sign}1`,
        ),
      ),
    )
  }

  private async controlSkip(players: PlayerConfig[]): Promise<void> {
    await Promise.all(
      players.map(player =>
        this.makeRequest(`http://${player.ip}:${player.port}/Skip`),
      ),
    )
  }

  public async controlVirtualPlayer(
    virtualPlayerName: string,
    action: string,
    modifier?: string,
    modifier2?: string,
  ): Promise<void> {
    const virtualPlayer = this.virtualPlayers[virtualPlayerName]
    if (!virtualPlayer) {
      console.error(`Invalid virtual player name: ${virtualPlayerName}`)
      return
    }

    const { primary, slaves } = virtualPlayer

    if (action === 'start') {
      const primaryStatus = await this.getPlayerStatus(primary)
      const slaveStatuses = await Promise.all(
        slaves.map(slave => this.getPlayerStatus(slave)),
      )
      const anyPlaying = slaveStatuses.some(status => status.isPlaying)

      if ((!primaryStatus.isPlaying || primaryStatus.isTv) && !anyPlaying) {
        // Stop any current playback and ungroup everything
        await this.ungroupPlayers(primary, slaves)

        // Group slaves with primary
        await Promise.all(
          slaves.map(slave =>
            this.makeRequest(
              `http://${primary.ip}:${primary.port}/AddSlave?slave=${slave.ip}&port=${slave.port}`,
            ),
          ),
        )

        // Set volumes
        await Promise.all([
          this.makeRequest(
            `http://${primary.ip}:${primary.port}/Volume?level=${primary.volume}`,
          ),
          ...slaves.map(slave =>
            this.makeRequest(
              `http://${slave.ip}:${slave.port}/Volume?level=${slave.volume}`,
            ),
          ),
        ])

        // Start playback on primary
        await this.makeRequest(
          `http://${primary.ip}:${primary.port}/Preset?id=${primary.preset}`,
        )
      } else {
        // Stop playback and ungroup
        await this.makeRequest(`http://${primary.ip}:${primary.port}/Stop`)
        await this.ungroupPlayers(primary, slaves)
      }
    } else if (action === 'stop') {
      await this.makeRequest(`http://${primary.ip}:${primary.port}/Stop`)
      await this.ungroupPlayers(primary, slaves)
    } else if (action === 'volume' && modifier) {
      await this.controlVolume([primary], modifier, modifier2)
    } else if (action === 'preset' && modifier) {
      await this.controlPreset([primary], modifier)
    } else if (action === 'skip') {
      await this.controlSkip([primary])
    }
  }

  public async controlPlayer(
    playerName: string,
    action: string,
    modifier?: string,
    modifier2?: string,
  ): Promise<void> {
    // Check if it's a virtual player first
    if (this.virtualPlayers[playerName]) {
      await this.controlVirtualPlayer(playerName, action, modifier, modifier2)
      return
    }

    // Otherwise treat as a regular player
    const player = this.players[playerName]
    if (!player) {
      console.error(`Invalid player name: ${playerName}`)
      return
    }

    if (action === 'start') {
      const status = await this.getPlayerStatus(player)

      if (!status.isPlaying || status.isTv) {
        await this.makeRequest(
          `http://${player.ip}:${player.port}/Volume?level=${player.volume}`,
        )
        await this.makeRequest(
          `http://${player.ip}:${player.port}/Preset?id=${player.preset}`,
        )
      } else {
        await this.makeRequest(`http://${player.ip}:${player.port}/Stop`)
      }
    } else if (action === 'stop') {
      await this.makeRequest(`http://${player.ip}:${player.port}/Stop`)
    } else if (action === 'volume' && modifier) {
      await this.controlVolume([player], modifier, modifier2)
    } else if (action === 'preset' && modifier) {
      await this.controlPreset([player], modifier)
    } else if (action === 'skip') {
      await this.controlSkip([player])
    }
  }

  public async getPlayerPlayingStatus(playerName: string): Promise<boolean> {
    // For virtual players, check all constituent players
    const virtualPlayer = this.virtualPlayers[playerName]
    if (virtualPlayer) {
      const primaryStatus = await this.getPlayerStatus(virtualPlayer.primary)
      const slaveStatuses = await Promise.all(
        virtualPlayer.slaves.map(slave => this.getPlayerStatus(slave)),
      )
      return (
        (primaryStatus.isPlaying && !primaryStatus.isTv)
        || slaveStatuses.some(status => status.isPlaying)
      )
    }

    // For regular players
    const player = this.players[playerName]
    if (!player) {
      console.error(`Invalid player name: ${playerName}`)
      return false
    }

    const status = await this.getPlayerStatus(player)
    return status.isPlaying && !status.isTv
  }
}
