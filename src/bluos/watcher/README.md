# BluOS watcher Systemd Service

This document explains how to install and manage the BluOS watcher as a systemd service.

## Overview

The BluOS watcher is a background service that synchronizes the Living and Kitchen audio zones.
It uses long polling to check living Status and maintain audio synchronization with kitchen.

 * Checks if the living player is set to TV, and ensures it is ungrouped from all other zones.
 * For any other source, it ensures Living is grouped with Kitchen.
 * Also sets Kitchen volume to a ratio of the Living volume based on config-defined default volumes (25 living, 10 kitchen).

## Installation

### Prerequisites

1. **Homebridge User**: The service runs as the `homebridge` user (or a user you specify)
2. **Sudo Privileges**: Installation requires sudo privileges to install as a system service
3. **Built Project**: The project must be built before installation

### 1. Install as Systemd System Service

Verify that `ExecStart` in bluos-watcher.service points to the node binary that homebridge is using, this is usually installed via hb-service
Run the installation script from the project root with sudo:

```bash
sudo ./src/bluos/watcher/install.sh
```

This will create the systemd service in `/etc/systemd/system/`, enable and start it.

### 2. Custom Homebridge User

If your Homebridge runs as a different user, you can specify it:

```bash
sudo HOMEBRIDGE_USER=myuser ./src/bluos/watcher/install.sh
```

### 3. Manual Installation

If you prefer to install manually:

1. Build the project: `npm run build`
2. Copy the service file to the system systemd directory:
   ```bash
   sudo cp src/bluos/watcher/bluos-watcher.service /etc/systemd/system/
   ```
3. Edit the service file to replace placeholders:
   - `%N` - Path to the Node.js executable (should match Homebridge's Node.js)
   - `%p` - Project directory path
4. Set proper ownership and permissions:
   ```bash
   sudo chown root:root /etc/systemd/system/bluos-watcher.service
   sudo chmod 644 /etc/systemd/system/bluos-watcher.service
   ```
5. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable bluos-watcher.service
   sudo systemctl start bluos-watcher.service
   ```

## Service Management

### Start the Service
```bash
sudo systemctl start bluos-watcher.service
```

### Stop the Service
```bash
sudo systemctl stop bluos-watcher.service
```

### Restart the Service
```bash
sudo systemctl restart bluos-watcher.service
```

### Check Service Status
```bash
sudo systemctl status bluos-watcher.service
```

### View Service Logs
```bash
sudo journalctl -u bluos-watcher.service -f
```

## Deployment Integration

The watcher is automatically restarted when you run `npm run deploy`, or explicilty `npm run via watcher:restart`.

## Uninstallation

To remove the systemd service, run from the project root with sudo:

```bash
sudo ./src/bluos/watcher/uninstall.sh
```

Or manually:
```bash
sudo systemctl stop bluos-watcher.service
sudo systemctl disable bluos-watcher.service
sudo rm /etc/systemd/system/bluos-watcher.service
sudo systemctl daemon-reload
```