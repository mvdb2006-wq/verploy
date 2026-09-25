<?php
/**
 * Integratietest van de update-engine (plugin 2.1+) tegen een draaiende WordPress-site op MySQL
 * met de labplugins (tests/lab/build-lab.sh) geïnstalleerd en de connector gekoppeld.
 *
 *   php tests/engine-test.php <site-url> <site-id> <secret>
 *
 * Stuurt ondertekende verzoeken zoals de worker en controleert elke stap. Laat de site
 * achter zoals hij was (labplugins op 1.0.0, geen staging, geen lock, geen onderhoudsmodus).
 */
if ( PHP_SAPI !== 'cli' || $argc < 4 ) {
	fwrite( STDERR, "Gebruik: php engine-test.php <site-url> <site-id> <secret>\n" );
	exit( 2 );
}
[ , $base, $site, $secret ] = $argv;
$base  = rtrim( $base, '/' );
$run   = sprintf( '%08x-0000-4000-8000-%012x', random_int( 0, 0xffffffff ), random_int( 0, 0xffffffffffff ) );
$other = '00000000-0000-4000-8000-000000000002';
$fails = 0;

function sign_req( $secret, $m, $p, $ts, $n, $b ) {
	return hash_hmac( 'sha256', implode( "\n", array( strtoupper( $m ), $p, $ts, $n, hash( 'sha256', $b ) ) ), $secret );
}
function call( $url, $route, array $body ) {
	global $site, $secret;
	$raw = json_encode( $body );
	$ts  = (string) time();
	$n   = bin2hex( random_bytes( 16 ) );
	$h   = array( 'Content-Type: application/json', "X-Verploy-Site: $site", "X-Verploy-Timestamp: $ts", "X-Verploy-Nonce: $n", 'X-Verploy-Signature: ' . sign_req( $secret, 'POST', $route, $ts, $n, $raw ) );
	$c   = curl_init( $url . '/?rest_route=' . $route );
	curl_setopt_array( $c, array( CURLOPT_POST => 1, CURLOPT_POSTFIELDS => $raw, CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 120 ) );
	$out = curl_exec( $c );
	return array( curl_getinfo( $c, CURLINFO_HTTP_CODE ), json_decode( (string) $out, true ) );
}
function page( $url, array $headers = array() ) {
	$c = curl_init( $url );
	curl_setopt_array( $c, array( CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 60 ) );
	$b = (string) curl_exec( $c );
	return array( curl_getinfo( $c, CURLINFO_HTTP_CODE ), preg_match( "/footer (v[0-9.]+)/", $b, $m ) ? $m[1] : null, $b );
}
function check( $name, $ok, $detail = '' ) {
	global $fails;
	echo ( $ok ? '  ✔ ' : '  ✘ ' ), $name, ( $ok || '' === $detail ? '' : "  → $detail" ), "\n";
	if ( ! $ok ) {
		$fails++;
	}
}
function until_ready( $url, $route, array $body ) {
	for ( $i = 0; $i < 100; $i++ ) {
		$r = call( $url, $route, $body );
		if ( 200 !== $r[0] || in_array( $r[1]['state'] ?? '', array( 'ready' ), true ) ) {
			return $r;
		}
	}
	return $r;
}

echo "Engine-test tegen $base (run $run)\n";
$r = call( $base, '/verploy/v2/run/lock', array( 'run_id' => $run, 'ttl' => 1800 ) );
check( 'lock verkregen', 200 === $r[0], json_encode( $r ) );
$r = call( $base, '/verploy/v2/run/lock', array( 'run_id' => $other ) );
check( 'tweede run krijgt 409', 409 === $r[0], json_encode( $r ) );
$r = call( $base, '/verploy/v2/staging/build', array( 'run_id' => $other ) );
check( 'actie zonder lock geweigerd', 409 === $r[0], json_encode( $r ) );

$r = until_ready( $base, '/verploy/v2/staging/build', array( 'run_id' => $run ) );
check( 'staging gebouwd', 200 === $r[0] && 'ready' === $r[1]['state'] && $r[1]['progress']['tables_total'] > 0, json_encode( $r ) );
$surl  = $r[1]['url'] ?? '';
$token = $r[1]['token'] ?? '';
check( 'staging zonder token geweigerd', 403 === page( $surl . '/' )[0] );
$p = page( $surl . '/', array( "X-Verploy-Staging: $token" ) );
check( 'staging met token toont site (footer v1.0.0)', 200 === $p[0] && 'v1.0.0' === $p[1], json_encode( $p ) );

$item = fn( $slug ) => array( 'type' => 'plugin', 'slug' => "$slug/$slug.php", 'to_version' => '1.1.0' );
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-footer' ) ) );
check( 'staging: footer-update uitgevoerd', 200 === $r[0] && 'updated' === $r[1]['status'], json_encode( $r ) );
check( 'staging toont footer v1.1.0', 'v1.1.0' === page( $surl . '/', array( "X-Verploy-Staging: $token" ) )[1] );
check( 'productie ongewijzigd (v1.0.0)', 'v1.0.0' === page( $base . '/' )[1] );
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-footer' ) ) );
check( 'zelfde update nogmaals is idempotent', 200 === $r[0] && 'already_current' === $r[1]['status'], json_encode( $r ) );
// Betaalde plugin met domeinlicentie: op de testkopie geen update, via het pakket van productie wel.
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-licensed' ) ) );
check( 'staging: licentieplugin zonder pakket → geen update aangeboden', 200 === $r[0] && 'no_update_available' === $r[1]['status'], json_encode( $r ) );
$r = call( $base, '/verploy/v2/updates/package', array( 'run_id' => $run, 'item' => $item( 'vp-lab-licensed' ) ) );
check( 'productie: pakket opgehaald met de eigen licentie', 200 === $r[0] && true === $r[1]['ok'] && '1.1.0' === $r[1]['version'] && preg_match( '/^[a-zA-Z0-9]{24}\.zip$/', $r[1]['file'] ?? '' ), json_encode( $r ) );
$pkg = $r[1]['file'] ?? '';
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-licensed' ) + array( 'package_file' => $pkg ) ) );
check( 'staging: licentieplugin bijgewerkt vanuit het pakket', 200 === $r[0] && 'updated' === $r[1]['status'] && '1.1.0' === $r[1]['to_version'], json_encode( $r ) );
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-licensed' ) + array( 'package_file' => '../../../wp-config.php' ) ) );
check( 'onveilige pakketnaam wordt genegeerd (geen pad buiten de pakketmap)', 200 === $r[0] && 'already_current' === $r[1]['status'], json_encode( $r ) );
$r = call( $base, '/verploy/v2/updates/package', array( 'run_id' => $run, 'item' => array( 'type' => 'plugin', 'slug' => 'vp-lab-licensed/vp-lab-licensed.php', 'to_version' => '9.9.9' ) ) );
check( 'productie: andere versie dan verwacht → geen pakket', 200 === $r[0] && 'version_changed' === $r[1]['status'], json_encode( $r ) );
// Functionele tests: doelen opvragen, en tijdens de test geen enkel uitgaand verzoek vanaf de testkopie.
$r = call( $surl, '/verploy/v2/run/functional', array( 'run_id' => $run ) );
check( 'staging: functionele doelen (lab heeft geen formulieren of winkel)', 200 === $r[0] && array() === $r[1]['forms'] && null === $r[1]['shop'], json_encode( $r ) );
$probe = fn( $headers ) => page( $surl . '/?vp_probe=1', array_merge( array( "X-Verploy-Staging: $token" ), $headers ) );
$p     = $probe( array( 'Cookie: verploy_functional=1' ) );
check( 'staging + functionele test: uitgaand verkeer geblokkeerd', false !== strpos( $p[2] ?? '', 'probe:verploy_functional_offline' ), json_encode( $p ) );
$p     = $probe( array() );
check( 'staging zonder functionele test: niet geblokkeerd door Verploy', 0 === strpos( $p[2] ?? '', 'probe:' ) && false === strpos( $p[2], 'verploy_functional_offline' ), json_encode( $p ) );
$p     = page( $base . '/?vp_probe=1', array( 'Cookie: verploy_functional=1' ) );
check( 'productie: de cookie heeft geen effect', false === strpos( $p[2] ?? '', 'verploy_functional_offline' ), json_encode( $p ) );
// Pakket ontbreekt (404): de update mislukt vóórdat er iets verandert; de oude versie staat er nog en werkt.
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-nopkg' ) ) );
check( 'staging: update zonder pakket mislukt, oude versie blijft staan (basis voor "fail isolated")',
	200 === $r[0] && 'update_failed' === $r[1]['status'] && '1.0.0' === $r[1]['from_version'] && '1.0.0' === $r[1]['to_version'], json_encode( $r ) );
check( 'staging werkt nog na de mislukte update', 200 === page( $surl . '/', array( "X-Verploy-Staging: $token" ) )[0] );
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-fatal' ) ) );
check( 'staging: fatal-update geïnstalleerd', 200 === $r[0] && 'updated' === $r[1]['status'], json_encode( $r ) );
check( 'staging geeft nu 500', 500 === page( $surl . '/', array( "X-Verploy-Staging: $token" ) )[0] );
$r = call( $surl, '/verploy/v2/run/diagnostics', array( 'run_id' => $run ) );
$f = $r[1]['fatals'][0] ?? array();
check( 'staging-diagnose: fatale fout vastgelegd, met plugin en zonder serverpad',
	200 === $r[0] && false !== strpos( $f['message'] ?? '', 'verploy_lab_function_that_does_not_exist' )
	&& 0 === strpos( $f['file'] ?? '', '…/wp-content/plugins/vp-lab-fatal/' ) && false === strpos( json_encode( $r[1] ), __DIR__ ), json_encode( $r ) );
check( 'staging-diagnose: omgeving met actieve plugins', in_array( 'vp-lab-fatal/vp-lab-fatal.php', array_column( $r[1]['environment']['plugins'] ?? array(), 'slug' ), true ), json_encode( $r[1]['environment'] ?? null ) );

$r = call( $base, '/verploy/v2/maintenance', array( 'run_id' => $run, 'enabled' => true, 'ttl' => 600 ) );
check( 'onderhoudsmodus aan', 200 === $r[0] );
check( 'bezoeker krijgt 503', 503 === page( $base . '/' )[0] );
$bypass = hash_hmac( 'sha256', 'bypass|' . $run, $secret );
check( 'worker met bypass krijgt de site', 200 === page( $base . '/', array( "X-Verploy-Bypass: $bypass" ) )[0] );

$r = until_ready( $base, '/verploy/v2/snapshot/create', array( 'run_id' => $run, 'items' => array( $item( 'vp-lab-prod-only' ) ) ) );
check( 'snapshot gemaakt', 200 === $r[0] && 'ready' === $r[1]['state'], json_encode( $r ) );
$r = call( $base, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-prod-only' ) ) );
check( 'productie: prod-only-update uitgevoerd', in_array( $r[0], array( 200, 500 ), true ), json_encode( $r ) );
check( 'productie geeft nu 500', 500 === page( $base . '/', array( "X-Verploy-Bypass: $bypass" ) )[0] );
check( 'REST-API ligt er ook uit', 500 === page( $base . '/?rest_route=/verploy/v2/status' )[0] );
$r = call( $base, '/verploy/v2/run/diagnostics', array( 'run_id' => $run ) );
check( 'diagnose via noodroute terwijl de site plat ligt', 200 === $r[0] && false !== strpos( json_encode( $r[1]['fatals'] ?? array() ), 'vp-lab-prod-only' ), json_encode( $r ) );
$r = call( $base, '/verploy/v2/rollback', array( 'run_id' => $other ) );
check( 'noodroute weigert andere run', 409 === $r[0], json_encode( $r ) );
$r = call( $base, '/verploy/v2/rollback', array( 'run_id' => $run ) );
check( 'rollback via noodroute', 200 === $r[0] && 'rolled_back' === $r[1]['state'], json_encode( $r ) );
$r = call( $base, '/verploy/v2/rollback', array( 'run_id' => $run ) );
check( 'rollback nogmaals is idempotent', 200 === $r[0] && 'rolled_back' === $r[1]['state'], json_encode( $r ) );
$p = page( $base . '/', array( "X-Verploy-Bypass: $bypass" ) );
check( 'productie weer gezond (v1.0.0)', 200 === $p[0] && 'v1.0.0' === $p[1], json_encode( $p ) );

$r = call( $base, '/verploy/v2/cleanup', array( 'run_id' => $run ) );
check( 'opgeruimd', 200 === $r[0] && 'cleaned' === $r[1]['state'], json_encode( $r ) );
check( 'pakketten van de run opgeruimd', ! is_dir( getenv( 'ENGINE_WP_DIR' ) . '/wp-content/verploy-backups/' . substr( str_replace( '-', '', $run ), 0, 8 ) . '-packages' ) );
check( 'staging bestaat niet meer', 'v1.0.0' !== page( $surl . '/', array( "X-Verploy-Staging: $token" ) )[1] );
$p = page( $base . '/' );
check( 'productie open voor bezoekers', 200 === $p[0] && 'v1.0.0' === $p[1], json_encode( $p ) );
$r = call( $base, '/verploy/v2/run/lock', array( 'run_id' => $other, 'ttl' => 60 ) );
check( 'lock vrijgegeven', 200 === $r[0] );
call( $base, '/verploy/v2/cleanup', array( 'run_id' => $other ) );


echo "Inloggen vanuit Verploy (SSO) over HTTP\n";
function sso_token( $claims ) {
	global $secret;
	$p = rtrim( strtr( base64_encode( json_encode( $claims ) ), '+/', '-_' ), '=' );
	return $p . '.' . hash_hmac( 'sha256', 'sso|' . $p, $secret );
}
function sso_post( $url, $token, $method = 'POST' ) {
	$c = curl_init( $url . '/wp-login.php?action=verploy_sso' );
	curl_setopt_array( $c, array( CURLOPT_CUSTOMREQUEST => $method, CURLOPT_POSTFIELDS => 'POST' === $method ? http_build_query( array( 'token' => $token ) ) : null, CURLOPT_RETURNTRANSFER => 1, CURLOPT_HEADER => 1, CURLOPT_TIMEOUT => 30 ) );
	$out = (string) curl_exec( $c );
	return array( curl_getinfo( $c, CURLINFO_HTTP_CODE ), $out );
}
$claims = array( 'v' => 1, 'site' => $site, 'aud' => $base, 'user' => 1, 'by' => 'engine@example.com', 'nonce' => bin2hex( random_bytes( 16 ) ), 'iat' => time(), 'exp' => time() + 60 );
$tok    = sso_token( $claims );
$r      = sso_post( $base, $tok );
check( 'geldig token: ingelogd en naar WP Admin', 302 === $r[0] && preg_match( '/^Location: .*\/wp-admin\/?\r?$/mi', $r[1] ) && false !== stripos( $r[1], 'wordpress_logged_in_' ), substr( $r[1], 0, 400 ) );
$r = sso_post( $base, $tok );
check( 'hetzelfde token nog eens: geweigerd (eenmalig)', 403 === $r[0] && false === stripos( $r[1], 'wordpress_logged_in_' ), (string) $r[0] );
$r = sso_post( $base, sso_token( array_merge( $claims, array( 'nonce' => bin2hex( random_bytes( 16 ) ), 'iat' => time() - 120, 'exp' => time() - 60 ) ) ) );
check( 'verlopen token: geweigerd', 403 === $r[0], (string) $r[0] );
$r = sso_post( $base, sso_token( array_merge( $claims, array( 'nonce' => bin2hex( random_bytes( 16 ) ), 'user' => 999999 ) ) ) );
check( 'onbekende gebruiker: geweigerd', 403 === $r[0], (string) $r[0] );
$r = sso_post( $base, sso_token( array_merge( $claims, array( 'nonce' => bin2hex( random_bytes( 16 ) ) ) ) ), 'GET' );
check( 'GET: geweigerd (alleen POST)', 403 === $r[0], (string) $r[0] );
$bad = sso_token( array_merge( $claims, array( 'nonce' => bin2hex( random_bytes( 16 ) ) ) ) );
$r   = sso_post( $base, substr( $bad, 0, -1 ) . ( '0' === substr( $bad, -1 ) ? '1' : '0' ) );
check( 'vervalste handtekening: geweigerd', 403 === $r[0], (string) $r[0] );
$r = sso_post( $base, sso_token( array_merge( $claims, array( 'nonce' => bin2hex( random_bytes( 16 ) ), 'aud' => 'https://kloon.example' ) ) ) );
check( 'token voor een ander adres (kloon): geweigerd', 403 === $r[0], (string) $r[0] );
$race = sso_token( array_merge( $claims, array( 'nonce' => bin2hex( random_bytes( 16 ) ) ) ) );
$mh   = curl_multi_init();
$hs   = array();
for ( $i = 0; $i < 4; $i++ ) {
	$c = curl_init( $base . '/wp-login.php?action=verploy_sso' );
	curl_setopt_array( $c, array( CURLOPT_POSTFIELDS => http_build_query( array( 'token' => $race ) ), CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 30 ) );
	curl_multi_add_handle( $mh, $c );
	$hs[] = $c;
}
do { curl_multi_exec( $mh, $running ); curl_multi_select( $mh ); } while ( $running );
$codes = array_map( function ( $c ) { return curl_getinfo( $c, CURLINFO_HTTP_CODE ); }, $hs );
check( 'vier gelijktijdige pogingen met hetzelfde token: precies één lukt', 1 === count( array_filter( $codes, function ( $x ) { return 302 === $x; } ) ), json_encode( $codes ) );

echo $fails ? "✘ $fails controle(s) mislukt\n" : "✔ alle controles geslaagd\n";
exit( $fails ? 1 : 0 );
