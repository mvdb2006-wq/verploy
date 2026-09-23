<?php
/**
 * Integratietests voor Verploy Connector, uitgevoerd binnen een echte WordPress.
 * Gebruik: WP_LOAD=/pad/naar/wp-load.php php run-tests.php
 */

$wp_load = getenv( 'WP_LOAD' );
if ( ! $wp_load || ! file_exists( $wp_load ) ) {
	fwrite( STDERR, "Zet WP_LOAD naar wp-load.php\n" );
	exit( 2 );
}
$_SERVER['HTTP_HOST']   = getenv( 'WP_HOST' ) ?: '127.0.0.1:8088';
$_SERVER['REQUEST_URI'] = '/';
require $wp_load;

$failures = 0;
$count    = 0;
function check( $name, $cond, $detail = '' ) {
	global $failures, $count;
	$count++;
	if ( $cond ) {
		echo "  ✓ {$name}\n";
	} else {
		$failures++;
		echo "  ✗ {$name}" . ( $detail ? " — {$detail}" : '' ) . "\n";
	}
}

echo "Verploy Connector " . VERPLOY_VERSION . " op WordPress " . get_bloginfo( 'version' ) . " / PHP " . PHP_VERSION . "\n";

echo "Signer\n";
// Zelfde vector als dashboard/src/lib/security/signing.test.ts (onafhankelijk berekend met openssl).
check( 'testvector gelijk aan TypeScript/openssl',
	'dfe01908feea374cb22544b3cb9ce0e190d88ebceca5d75d7a3e738842a101e8' === Verploy_Signer::sign( 'test-secret', 'POST', '/api/v2/heartbeat', '1700000000', '0123456789abcdef0123456789abcdef', '{"a":1}' ) );

$site   = '5ee00000-0000-4000-8000-000000000001';
$secret = str_repeat( 'a', 64 );
$h      = array_change_key_case( Verploy_Signer::headers( $site, $secret, 'GET', '/verploy/v2/status', '' ), CASE_LOWER );
check( 'geldige handtekening wordt geaccepteerd', true === Verploy_Signer::verify( $site, $secret, $h, 'GET', '/verploy/v2/status', '' ) );
check( 'dezelfde nonce opnieuw = replay', 'replay' === Verploy_Signer::verify( $site, $secret, $h, 'GET', '/verploy/v2/status', '' ) );
$h2 = array_change_key_case( Verploy_Signer::headers( $site, $secret, 'GET', '/verploy/v2/status', '' ), CASE_LOWER );
check( 'verkeerd secret wordt geweigerd', 'bad_signature' === Verploy_Signer::verify( $site, str_repeat( 'b', 64 ), $h2, 'GET', '/verploy/v2/status', '' ) );
$h3 = array_change_key_case( Verploy_Signer::headers( $site, $secret, 'GET', '/verploy/v2/status', '' ), CASE_LOWER );
check( 'ander pad wordt geweigerd', 'bad_signature' === Verploy_Signer::verify( $site, $secret, $h3, 'GET', '/verploy/v2/other', '' ) );
$h4 = array_change_key_case( Verploy_Signer::headers( $site, $secret, 'GET', '/verploy/v2/status', '' ), CASE_LOWER );
check( 'verlopen tijdstempel wordt geweigerd', 'stale' === Verploy_Signer::verify( $site, $secret, $h4, 'GET', '/verploy/v2/status', '', time() + 301 ) );
$h5 = array_change_key_case( Verploy_Signer::headers( 'andere-site-id-0000-0000-000000000000', $secret, 'GET', '/verploy/v2/status', '' ), CASE_LOWER );
check( 'andere site-id wordt geweigerd', 'unknown_site' === Verploy_Signer::verify( $site, $secret, $h5, 'GET', '/verploy/v2/status', '' ) );
check( 'ontbrekende headers worden geweigerd', 'missing_signature' === Verploy_Signer::verify( $site, $secret, array(), 'GET', '/x', '' ) );

echo "Health collector\n";
$p = Verploy_Health_Collector::collect();
check( 'schema 2', 2 === $p['schema'] );
check( 'collected_at is ISO-8601 UTC', (bool) preg_match( '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $p['collected_at'] ) );
check( 'php-versie ingevuld', is_string( $p['server']['php_version'] ) && '' !== $p['server']['php_version'] );
check( 'wordpress-versie ingevuld', get_bloginfo( 'version' ) === $p['wordpress']['version'] );
check( 'plugins bevat de connector zelf', in_array( 'verploy-connector/verploy-connector.php', wp_list_pluck( $p['plugins'], 'file' ), true ) );
check( 'actief thema gemarkeerd', 1 === count( array_filter( $p['themes'], function ( $t ) { return $t['active']; } ) ) );
check( 'payload is geldige JSON', false !== wp_json_encode( $p ) );

echo "REST\n";
$server = rest_get_server();
check( 'route /verploy/v2/status bestaat', isset( $server->get_routes()['/verploy/v2/status'] ) );
update_option( Verploy_Connection::OPT_SITE_ID, $site, false );
update_option( Verploy_Connection::OPT_SECRET, $secret, false );
$req = new WP_REST_Request( 'GET', '/verploy/v2/status' );
$res = rest_do_request( $req );
check( 'zonder handtekening: 401', 401 === $res->get_status(), (string) $res->get_status() );
$req = new WP_REST_Request( 'GET', '/verploy/v2/status' );
foreach ( Verploy_Signer::headers( $site, $secret, 'GET', '/verploy/v2/status', '' ) as $k => $v ) {
	$req->set_header( $k, $v );
}
$res = rest_do_request( $req );
check( 'met geldige handtekening: 200', 200 === $res->get_status(), (string) $res->get_status() );
check( 'status meldt connector-versie', isset( $res->get_data()['connector_version'] ) && VERPLOY_VERSION === $res->get_data()['connector_version'] );
Verploy_Connection::disconnect();

echo "\n{$count} controles, {$failures} gefaald\n";
exit( $failures ? 1 : 0 );
