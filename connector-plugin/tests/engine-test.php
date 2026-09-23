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
	return array( curl_getinfo( $c, CURLINFO_HTTP_CODE ), preg_match( '/footer (v[0-9.]+)/', $b, $m ) ? $m[1] : null );
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
$r = call( $surl, '/verploy/v2/updates/apply', array( 'run_id' => $run, 'item' => $item( 'vp-lab-fatal' ) ) );
check( 'staging: fatal-update geïnstalleerd', 200 === $r[0] && 'updated' === $r[1]['status'], json_encode( $r ) );
check( 'staging geeft nu 500', 500 === page( $surl . '/', array( "X-Verploy-Staging: $token" ) )[0] );

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
check( 'staging bestaat niet meer', 'v1.0.0' !== page( $surl . '/', array( "X-Verploy-Staging: $token" ) )[1] );
$p = page( $base . '/' );
check( 'productie open voor bezoekers', 200 === $p[0] && 'v1.0.0' === $p[1], json_encode( $p ) );
$r = call( $base, '/verploy/v2/run/lock', array( 'run_id' => $other, 'ttl' => 60 ) );
check( 'lock vrijgegeven', 200 === $r[0] );
call( $base, '/verploy/v2/cleanup', array( 'run_id' => $other ) );

echo $fails ? "✘ $fails controle(s) mislukt\n" : "✔ alle controles geslaagd\n";
exit( $fails ? 1 : 0 );
