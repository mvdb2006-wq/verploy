<?php
/**
 * Zet de lab-WordPress (MySQL) terug in de beginstand voor de E2E-tests van de kernflow:
 * labplugins 1.0.0 + lab-updater geïnstalleerd en actief, geen Verploy-koppeling, geen
 * run-restanten (lock, onderhoudsmodus, staging, back-ups).
 *
 *   php connector-plugin/tests/lab/lab-reset.php <wordpress-map> <lab-map> <site-url> [connector-bronmap]
 *
 * Met een connector-bronmap wordt ook Verploy Connector vervangen door die versie.
 * Met VERPLOY_PAIR="<site-id> <secret>" wordt de connector direct gekoppeld (voor de engine-test).
 */
if ( PHP_SAPI !== 'cli' || $argc < 4 ) { fwrite( STDERR, "gebruik: lab-reset.php <wp> <lab> <url>\n" ); exit( 2 ); }
[ , $lab_wp_dir, $lab_dir, $lab_url ] = $argv; // let op: $wp is een WordPress-global
$u = parse_url( $lab_url );
$_SERVER['HTTP_HOST']   = $u['host'] . ( isset( $u['port'] ) ? ':' . $u['port'] : '' );
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $lab_wp_dir, '/' ) . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
WP_Filesystem();

$slugs = array( 'vp-lab-footer', 'vp-lab-fatal', 'vp-lab-prod-only', 'vp-lab-licensed', 'vp-lab-updater' );
foreach ( $slugs as $slug ) {
	$dir = WP_PLUGIN_DIR . '/' . $slug;
	if ( is_dir( $dir ) ) { $GLOBALS['wp_filesystem']->delete( $dir, true ); }
	$zip = new ZipArchive();
	if ( true !== $zip->open( rtrim( $lab_dir, '/' ) . "/install/$slug.zip" ) ) { fwrite( STDERR, "zip ontbreekt: $slug\n" ); exit( 1 ); }
	$zip->extractTo( WP_PLUGIN_DIR );
	$zip->close();
}
if ( isset( $argv[4] ) ) {
	$dest = WP_PLUGIN_DIR . '/verploy-connector';
	if ( is_dir( $dest ) ) { $GLOBALS['wp_filesystem']->delete( $dest, true ); }
	wp_mkdir_p( $dest );
	$copied = copy_dir( rtrim( $argv[4], '/' ), $dest );
	if ( is_wp_error( $copied ) ) { fwrite( STDERR, $copied->get_error_message() . "\n" ); exit( 1 ); }
}
wp_clean_plugins_cache( true );
$active = array_values( array_filter( (array) get_option( 'active_plugins', array() ), function ( $p ) { return 0 !== strpos( $p, 'vp-lab-' ); } ) );
foreach ( $slugs as $slug ) { $active[] = "$slug/$slug.php"; }
if ( ! in_array( 'verploy-connector/verploy-connector.php', $active, true ) ) { $active[] = 'verploy-connector/verploy-connector.php'; }
update_option( 'active_plugins', array_values( array_unique( $active ) ) );

foreach ( array( 'verploy_site_id', 'verploy_secret', 'verploy_paired_at', 'verploy_last_heartbeat', 'verploy_run_lock', 'verploy_run_state', 'verploy_maintenance' ) as $o ) { delete_option( $o ); }
delete_site_transient( 'update_plugins' );
delete_transient( 'vp_lab_manifest' );
$mu = WPMU_PLUGIN_DIR . '/verploy-rescue.php';
if ( is_file( $mu ) ) { unlink( $mu ); }
foreach ( array( 'verploy-staging', 'verploy-backups' ) as $d ) {
	if ( is_dir( WP_CONTENT_DIR . "/$d" ) ) { $GLOBALS['wp_filesystem']->delete( WP_CONTENT_DIR . "/$d", true ); }
}
global $wpdb;
foreach ( (array) $wpdb->get_col( "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LEFT(TABLE_NAME, 4) = 'vpst' OR LEFT(TABLE_NAME, 4) = 'vpbk' )" ) as $t ) {
	$wpdb->query( "DROP TABLE `$t`" );
}
$pair = getenv( 'VERPLOY_PAIR' );
if ( $pair ) {
	list( $pair_id, $pair_secret ) = explode( ' ', $pair, 2 );
	update_option( 'verploy_site_id', $pair_id, false );
	update_option( 'verploy_secret', $pair_secret, false );
}
echo "lab klaar\n";
