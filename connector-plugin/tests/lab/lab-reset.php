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

// Functionele-testlab (functional-setup.php) weer weghalen: plugins, en de pagina's, formulieren en het product.
$functional = array( 'contact-form-7/wp-contact-form-7.php', 'wpforms-lite/wpforms.php', 'woocommerce/woocommerce.php' );
foreach ( get_posts( array( 'post_type' => array( 'page', 'post', 'product', 'wpforms', 'wpcf7_contact_form' ), 'post_status' => 'any', 'numberposts' => -1, 'meta_key' => '_verploy_lab_functional' ) ) as $p ) {
	wp_delete_post( $p->ID, true );
}
update_option( 'active_plugins', array_values( array_diff( (array) get_option( 'active_plugins', array() ), $functional ) ) );
foreach ( $functional as $f ) {
	$dir = WP_PLUGIN_DIR . '/' . dirname( $f );
	if ( is_dir( $dir ) ) { $GLOBALS['wp_filesystem']->delete( $dir, true ); }
}
// … en hun tabellen (WooCommerce, WPForms, Action Scheduler), zodat de lab weer een kale WordPress is.
global $wpdb;
foreach ( (array) $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( TABLE_NAME LIKE %s OR TABLE_NAME LIKE %s OR TABLE_NAME LIKE %s OR TABLE_NAME LIKE %s )',
	$wpdb->esc_like( $wpdb->prefix . 'wc_' ) . '%', $wpdb->esc_like( $wpdb->prefix . 'woocommerce_' ) . '%', $wpdb->esc_like( $wpdb->prefix . 'wpforms_' ) . '%', $wpdb->esc_like( $wpdb->prefix . 'actionscheduler_' ) . '%' ) ) as $t ) {
	$wpdb->query( "DROP TABLE `$t`" );
}

$slugs = array( 'vp-lab-footer', 'vp-lab-fatal', 'vp-lab-prod-only', 'vp-lab-licensed', 'vp-lab-extra', 'vp-lab-nopkg', 'vp-lab-nopkg-addon', 'vp-lab-formbreak', 'vp-lab-slider', 'vp-lab-probe', 'vp-lab-updater' );
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
delete_option( 'vp_lab_slider' );
wp_clean_plugins_cache( true );
$active = array_values( array_filter( (array) get_option( 'active_plugins', array() ), function ( $p ) { return 0 !== strpos( $p, 'vp-lab-' ); } ) );
foreach ( $slugs as $slug ) { $active[] = "$slug/$slug.php"; }
if ( ! in_array( 'verploy-connector/verploy-connector.php', $active, true ) ) { $active[] = 'verploy-connector/verploy-connector.php'; }
update_option( 'active_plugins', array_values( array_unique( $active ) ) );

foreach ( array( 'verploy_site_id', 'verploy_secret', 'verploy_paired_at', 'verploy_last_heartbeat', 'verploy_run_lock', 'verploy_run_state', 'verploy_maintenance' ) as $o ) { delete_option( $o ); }
delete_site_transient( 'update_plugins' );
delete_transient( 'verploy_update_info' );   // eventueel gezet door de zelf-update-test
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
