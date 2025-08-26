#!/bin/bash

# BluOS watcher systemd service installer
# This script installs the BluOS watcher as a systemd service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Installing BluOS watcher as systemd service...${NC}"

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run with sudo privileges to install as a system service${NC}"
    echo -e "${YELLOW}Please run: sudo $0${NC}"
    exit 1
fi

# Get the homebridge user (default to 'homebridge' if not specified)
HOMEBRIDGE_USER=${HOMEBRIDGE_USER:-homebridge}
echo -e "${YELLOW}Installing for user: ${HOMEBRIDGE_USER}${NC}"

# Check if homebridge user exists
if ! id "$HOMEBRIDGE_USER" &>/dev/null; then
    echo -e "${RED}Error: User '${HOMEBRIDGE_USER}' does not exist${NC}"
    echo -e "${YELLOW}Please create the homebridge user first or set HOMEBRIDGE_USER environment variable${NC}"
    echo -e "${YELLOW}Example: sudo adduser --system --group --home /var/lib/homebridge homebridge${NC}"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "src/bluos/watcher/watcher.ts" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

# Check if the watcher is already built
if [ ! -f "dist/bluos/watcher/watcher.js" ]; then
    echo -e "${RED}Error: watcher not built. Run 'npm run build' first.${NC}"
    exit 1
fi

echo -e "${YELLOW}Using Node.js path hardcoded in service file${NC}"

# Create the systemd system directory
SYSTEMD_SYSTEM_DIR="/etc/systemd/system"
echo -e "${YELLOW}Installing to system directory: ${SYSTEMD_SYSTEM_DIR}${NC}"

# Copy the service file and replace placeholders
SERVICE_FILE="$SYSTEMD_SYSTEM_DIR/bluos-watcher.service"
cp src/bluos/watcher/bluos-watcher.service "$SERVICE_FILE"

# Get the current project directory (absolute path)
PROJECT_DIR=$(pwd)
echo -e "${YELLOW}Project directory: ${PROJECT_DIR}${NC}"

# Replace project directory placeholder
sed -i.bak "s|%p|$PROJECT_DIR|g" "$SERVICE_FILE"

# Remove backup file
rm "${SERVICE_FILE}.bak"

# Set proper ownership and permissions
chown root:root "$SERVICE_FILE"
chmod 644 "$SERVICE_FILE"

echo -e "${GREEN}Service file installed to: ${SERVICE_FILE}${NC}"
echo -e "${GREEN}Service will run as user: ${HOMEBRIDGE_USER}${NC}"

# Enable and start the service
echo -e "${YELLOW}Enabling and starting the service...${NC}"
systemctl daemon-reload
systemctl enable bluos-watcher.service
systemctl start bluos-watcher.service

# Check service status
echo -e "${YELLOW}Service status:${NC}"
systemctl status bluos-watcher.service --no-pager

echo -e "${GREEN}BluOS watcher installed successfully as a system service!${NC}"
echo -e "${YELLOW}To manage the service:${NC}"
echo -e "  Start:   sudo systemctl start bluos-watcher.service"
echo -e "  Stop:    sudo systemctl stop bluos-watcher.service"
echo -e "  Restart: sudo systemctl restart bluos-watcher.service"
echo -e "  Status:  sudo systemctl status bluos-watcher.service"
echo -e "  Logs:    sudo journalctl -u bluos-watcher.service -f"
