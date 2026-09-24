#!/usr/bin/env bash
# Bouwt het Verploy-testlab: drie labplugins (1.0.0 om te installeren, 1.1.0 als update)
# en de lab-updater die updates aanbiedt vanaf LAB_REPO_URL (zoals premium plugins dat doen).
#
#   vp-lab-footer     1.0.0 → 1.1.0  onschuldige tekstwijziging        → verwacht: live
#   vp-lab-fatal      1.0.0 → 1.1.0  fatale fout op elke pagina        → verwacht: tegengehouden op staging
#   vp-lab-prod-only  1.0.0 → 1.1.0  breekt alleen buiten staging      → verwacht: teruggedraaid na post-check
#   vp-lab-licensed   1.0.0 → 1.1.0  update alleen op het eigen domein  → zoals betaalde plugins met domeinlicentie
#
# Gebruik: build-lab.sh <uitvoermap> <publieke-repo-url>
set -euo pipefail
OUT="${1:?uitvoermap}"; REPO_URL="${2:?publieke URL van de repo, bijv. http://127.0.0.1:8090}"
rm -rf "$OUT"; mkdir -p "$OUT/install" "$OUT/repo" "$OUT/src"

plugin() { # slug versie body
  local dir="$OUT/src/$1-$2/$1"; mkdir -p "$dir"
  cat > "$dir/$1.php" <<PHP
<?php
/**
 * Plugin Name: Verploy Lab — $1
 * Description: Testplugin voor de Verploy-kernflow. Niet voor productie.
 * Version: $2
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
$3
PHP
}

FOOTER='add_action( '"'"'wp_footer'"'"', function () { echo '"'"'<p class="vp-lab-footer" style="font:12px/1 sans-serif;text-align:center;margin:8px">Verploy lab — footer %s</p>'"'"'; } );'
plugin vp-lab-footer 1.0.0 "$(printf "$FOOTER" 'v1.0.0')"
plugin vp-lab-footer 1.1.0 "$(printf "$FOOTER" 'v1.1.0')"
plugin vp-lab-fatal 1.0.0 '// 1.0.0 doet niets.'
plugin vp-lab-fatal 1.1.0 'add_action( '"'"'template_redirect'"'"', function () { verploy_lab_function_that_does_not_exist(); } );'
plugin vp-lab-prod-only 1.0.0 '// 1.0.0 doet niets.'
# Fataal al bij het laden (ook de REST-API ligt eruit): bewijst dat de rollback-noodroute werkt.
plugin vp-lab-prod-only 1.1.0 'if ( ! defined( '"'"'VERPLOY_STAGING'"'"' ) ) { verploy_lab_function_that_does_not_exist(); }'
LICENSED='add_action( '"'"'wp_footer'"'"', function () { echo '"'"'<p class="vp-lab-licensed">licensed %s</p>'"'"'; } );'
plugin vp-lab-licensed 1.0.0 "$(printf "$LICENSED" 'v1.0.0')"
plugin vp-lab-licensed 1.1.0 "$(printf "$LICENSED" 'v1.1.0')"

mkdir -p "$OUT/src/vp-lab-updater/vp-lab-updater"
cat > "$OUT/src/vp-lab-updater/vp-lab-updater/vp-lab-updater.php" <<'PHP'
<?php
/**
 * Plugin Name: Verploy Lab — updater
 * Description: Biedt updates voor de Verploy-labplugins aan vanaf de lab-repository (testomgeving). Niet voor productie.
 * Version: 1.0.0
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
define( 'VP_LAB_REPO', '__REPO_URL__' );

function vp_lab_manifest() {
	static $manifest = null;
	if ( null !== $manifest ) { return $manifest; }
	$cached = get_transient( 'vp_lab_manifest' );
	if ( is_array( $cached ) ) { return $manifest = $cached; }
	$res = wp_remote_get( VP_LAB_REPO . '/manifest.json', array( 'timeout' => 5 ) );
	$manifest = is_wp_error( $res ) ? array() : (array) json_decode( wp_remote_retrieve_body( $res ), true );
	set_transient( 'vp_lab_manifest', $manifest, 60 );
	return $manifest;
}

// Leesfilter (niet alleen bij opslaan): werkt ook als api.wordpress.org onbereikbaar is.
add_filter( 'site_transient_update_plugins', function ( $t ) {
	if ( ! function_exists( 'get_plugins' ) ) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
	$t = is_object( $t ) ? $t : new stdClass();
	if ( ! isset( $t->response ) ) { $t->response = array(); }
	foreach ( get_plugins() as $file => $data ) {
		$slug = dirname( $file );
		$m    = vp_lab_manifest();
		// Zoals een betaalde plugin met domeinlicentie: op een ander adres (de testkopie) geen update.
		$licensed_elsewhere = ! empty( $m[ $slug ]['licensed'] ) && defined( 'VERPLOY_STAGING' );
		if ( isset( $m[ $slug ] ) && ! $licensed_elsewhere && version_compare( $m[ $slug ]['version'], $data['Version'], '>' ) ) {
			$t->response[ $file ] = (object) array( 'slug' => $slug, 'plugin' => $file, 'new_version' => $m[ $slug ]['version'], 'package' => $m[ $slug ]['package'], 'url' => VP_LAB_REPO );
		} else {
			unset( $t->response[ $file ] );
		}
	}
	return $t;
} );

// De lab-repository mag op een lokaal adres staan (alleen in de testomgeving).
add_filter( 'http_request_host_is_external', function ( $external, $host ) {
	return $external || wp_parse_url( VP_LAB_REPO, PHP_URL_HOST ) === $host;
}, 10, 2 );
add_filter( 'http_allowed_safe_ports', function ( $ports ) {
	$port = wp_parse_url( VP_LAB_REPO, PHP_URL_PORT );
	if ( $port ) { $ports[] = (int) $port; }
	return $ports;
} );
PHP
sed -i "s#__REPO_URL__#${REPO_URL}#" "$OUT/src/vp-lab-updater/vp-lab-updater/vp-lab-updater.php"

echo '{' > "$OUT/repo/manifest.json"; first=1
for slug in vp-lab-footer vp-lab-fatal vp-lab-prod-only vp-lab-licensed; do
  ( cd "$OUT/src/$slug-1.0.0" && zip -qrX "$OUT/install/$slug.zip" "$slug" )
  ( cd "$OUT/src/$slug-1.1.0" && zip -qrX "$OUT/repo/$slug-1.1.0.zip" "$slug" )
  [ $first = 1 ] || echo ',' >> "$OUT/repo/manifest.json"; first=0
  licensed=false; [ "$slug" = vp-lab-licensed ] && licensed=true
  printf '"%s": {"version": "1.1.0", "package": "%s/%s-1.1.0.zip", "licensed": %s}' "$slug" "$REPO_URL" "$slug" "$licensed" >> "$OUT/repo/manifest.json"
done
echo '}' >> "$OUT/repo/manifest.json"
( cd "$OUT/src/vp-lab-updater" && zip -qrX "$OUT/install/vp-lab-updater.zip" vp-lab-updater )
rm -rf "$OUT/src"
echo "✔ lab gebouwd in $OUT (repo: $REPO_URL)"
