#!/usr/bin/env bash
# Bouwt Verploy Connector in twee varianten en publiceert de direct-build naar het dashboard.
#   direct : met zelf-updater (voor installaties buiten WordPress.org)
#   wporg  : zonder updater (WordPress.org-richtlijn 8)
# Releaseregel: niets wordt gepubliceerd zonder groene PHP-tests en PHP 7.4-compatibiliteitscheck.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(sed -n "s/^define( 'VERPLOY_VERSION', '\([0-9.]*\)' );/\1/p" "$HERE/verploy-connector/verploy-connector.php")"
: "${WP_LOAD:?zet WP_LOAD naar wp-load.php van een test-WordPress met deze plugin actief}"
: "${PHPCS:?zet PHPCS naar phpcs.phar (met PHPCompatibility geïnstalleerd)}"

echo "▶ PHP 7.4-compatibiliteit"
php "$PHPCS" --standard=PHPCompatibility --runtime-set testVersion 7.4- -q "$HERE/verploy-connector"
echo "▶ Syntax"
find "$HERE/verploy-connector" -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null
echo "▶ Integratietests in WordPress"
WP_PLUGIN_DIR="$(dirname "$WP_LOAD")/wp-content/plugins/verploy-connector"
rm -rf "$WP_PLUGIN_DIR" && cp -r "$HERE/verploy-connector" "$WP_PLUGIN_DIR"
php "$HERE/tests/run-tests.php" 2>/dev/null

DIST="$HERE/dist"; rm -rf "$DIST"; mkdir -p "$DIST"
STAGE="$(mktemp -d)"
cp -r "$HERE/verploy-connector" "$STAGE/verploy-connector"
( cd "$STAGE" && zip -qrX "$DIST/verploy-connector-$VERSION.zip" verploy-connector )
rm "$STAGE/verploy-connector/includes/class-updater.php"
( cd "$STAGE" && zip -qrX "$DIST/verploy-connector-$VERSION-wporg.zip" verploy-connector )
rm -rf "$STAGE"

mkdir -p "$HERE/../dashboard/public/downloads"
rm -f "$HERE/../dashboard/public/downloads/"verploy-connector-*.zip
cp "$DIST/verploy-connector-$VERSION.zip" "$HERE/../dashboard/public/downloads/"
echo "✔ $VERSION gebouwd en gepubliceerd naar dashboard/public/downloads/"
