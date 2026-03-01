#!/bin/bash
# Install Godot 4.6.1 ARM64 + Web Export Template + Xvfb into tpl-openclaw
# Run on oracle (10.0.1.3): lxc exec tpl-openclaw -- bash < setup-godot.sh
set -euo pipefail

GODOT_VERSION="4.6.1"
GODOT_URL="https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_linux.arm64.zip"
EXPORT_TPL_URL="https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_export_templates.tpz"

echo "📦 Installing Godot ${GODOT_VERSION} ARM64..."

# 1. Download and install Godot
cd /tmp
wget -q "${GODOT_URL}" -O godot.zip
unzip -o godot.zip
mv "Godot_v${GODOT_VERSION}-stable_linux.arm64" /usr/local/bin/godot
chmod +x /usr/local/bin/godot
rm godot.zip

# 2. Install Web Export Template
echo "📦 Installing Web Export Template (~1.2GB, this takes a while)..."
wget -q "${EXPORT_TPL_URL}" -O templates.tpz
mkdir -p /root/.local/share/godot/export_templates/${GODOT_VERSION}.stable
unzip -o templates.tpz -d /tmp/tpl
mv /tmp/tpl/templates/* /root/.local/share/godot/export_templates/${GODOT_VERSION}.stable/
rm -rf templates.tpz /tmp/tpl

# 3. Install Xvfb + ImageMagick (virtual display + screenshots)
apt-get update -qq && apt-get install -y -qq xvfb imagemagick > /dev/null

# 4. Set up godot-tools directory
mkdir -p /opt/godot-tools
# godot_operations.gd will be copied separately

# 5. Create Web export preset template
mkdir -p /opt/godot-tools/templates
cat > /opt/godot-tools/templates/export_presets.cfg << 'EOF'
[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="export/web/index.html"

[preset.0.options]
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
progressive_web_app/enabled=false
EOF

# 6. Verify installation
echo "✅ Godot $(godot --version) installed"
echo "✅ Web Export Template installed at /root/.local/share/godot/export_templates/${GODOT_VERSION}.stable/"
echo "✅ Xvfb installed: $(which Xvfb)"
echo "✅ ImageMagick installed: $(which import)"
echo "✅ Export preset template at /opt/godot-tools/templates/export_presets.cfg"
