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
: "${ENGINE_WP_DIR:?zet ENGINE_WP_DIR naar de map van een test-WordPress op MySQL met de labplugins (tests/lab)}"
: "${WPCLI:?zet WPCLI naar wp-cli.phar (voor de WordPress.org Plugin Check)}"
: "${ENGINE_SITE:?zet ENGINE_SITE naar '<url> <site-id> <secret>' van die test-WordPress}"

echo "▶ PHP 7.4-compatibiliteit"
php "$PHPCS" --standard=PHPCompatibility --runtime-set testVersion 7.4- -q "$HERE/verploy-connector"
echo "▶ Syntax"
find "$HERE/verploy-connector" -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null
echo "▶ Integratietests in WordPress"
WP_PLUGIN_DIR="$(dirname "$WP_LOAD")/wp-content/plugins/verploy-connector"
rm -rf "$WP_PLUGIN_DIR" && cp -r "$HERE/verploy-connector" "$WP_PLUGIN_DIR"
php "$HERE/tests/run-tests.php" 2>/dev/null
echo "▶ Update-engine (staging, deploy, rollback) op MySQL"
# Labsite terug naar de beginstand, met deze versie van de connector en gekoppeld met de test-sleutel
read -r ENGINE_URL ENGINE_ID ENGINE_SECRET <<< "$ENGINE_SITE"
: "${ENGINE_LAB_DIR:?zet ENGINE_LAB_DIR naar de map van tests/lab/build-lab.sh}"
VERPLOY_PAIR="$ENGINE_ID $ENGINE_SECRET" php "$HERE/tests/lab/lab-reset.php" "$ENGINE_WP_DIR" "$ENGINE_LAB_DIR" "$ENGINE_URL" "$HERE/verploy-connector"
# shellcheck disable=SC2086
php "$HERE/tests/engine-test.php" $ENGINE_SITE

DIST="$HERE/dist"; rm -rf "$DIST"; mkdir -p "$DIST"
STAGE="$(mktemp -d)"
cp -r "$HERE/verploy-connector" "$STAGE/verploy-connector"
( cd "$STAGE" && zip -qrX "$DIST/verploy-connector-$VERSION.zip" verploy-connector )
rm "$STAGE/verploy-connector/includes/class-updater.php"
( cd "$STAGE" && zip -qrX "$DIST/verploy-connector-$VERSION-wporg.zip" verploy-connector )
rm -rf "$STAGE"

echo "▶ WordPress.org Plugin Check (wporg-build; plugin 'plugin-check' moet in de test-WordPress staan)"
PC_DIR="$ENGINE_WP_DIR/wp-content/plugins/verploy-connector"
rm -rf "$PC_DIR" && mkdir -p "$PC_DIR" && ( cd "$(dirname "$PC_DIR")" && unzip -q -o "$DIST/verploy-connector-$VERSION-wporg.zip" )
php "$WPCLI" --allow-root --path="$ENGINE_WP_DIR" plugin activate plugin-check >/dev/null
( cd "$ENGINE_WP_DIR" && php "$WPCLI" --allow-root plugin check verploy-connector ) 2>&1 | tee /tmp/verploy-plugin-check.txt | tail -1   # vanuit de WP-map: anders pakt Plugin Check de bronmap met dezelfde naam
grep -q "No errors found" /tmp/verploy-plugin-check.txt || { echo "✘ Plugin Check vond problemen"; exit 1; }
rm -rf "$PC_DIR" && cp -r "$HERE/verploy-connector" "$PC_DIR"

mkdir -p "$HERE/../dashboard/public/downloads"
rm -f "$HERE/../dashboard/public/downloads/"verploy-connector-*.zip
cp "$DIST/verploy-connector-$VERSION.zip" "$HERE/../dashboard/public/downloads/"
echo "✔ $VERSION gebouwd en gepubliceerd naar dashboard/public/downloads/"
